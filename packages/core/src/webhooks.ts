import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type pg from 'pg';
import { withClinic, type Db } from '@sahayak/db';

export const WEBHOOK_EVENTS = [
  'patient.checked_in',
  'queue.called',
  'visit.finished',
  'appointment.booked',
  'appointment.cancelled',
  'appointment.rescheduled',
  'flag.raised',
  'schedule.shifted',
  'message.received',
  'patient.erased',
  'document.received',
  'ping',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/**
 * Queue an outbound event for every active webhook subscribed to it. Runs inside the tool's transaction, so the
 * event exists if and only if the change committed. `data` must hold ids and non-identifying facts only;
 * `personal` is added only for webhooks the clinic set to level "full".
 */
export async function emitWebhook(
  db: Db,
  clinicId: string,
  type: WebhookEvent,
  data: Record<string, unknown>,
  personal?: { patientId?: string | null; extra?: Record<string, unknown> },
) {
  const hooks = (
    await db.query('SELECT id, level FROM webhooks WHERE active AND $1 = ANY(events)', [type])
  ).rows;
  if (!hooks.length) return;
  let patient: Record<string, unknown> | undefined;
  if (personal?.patientId && hooks.some((h) => h.level === 'full')) {
    const p = (
      await db.query('SELECT id, name, phone, language FROM patients WHERE id=$1', [
        personal.patientId,
      ])
    ).rows[0];
    if (p) patient = { id: p.id, name: p.name, phone: p.phone, language: p.language };
  }
  const eventId = randomUUID();
  for (const h of hooks) {
    const payload =
      h.level === 'full'
        ? { ...data, ...(personal?.extra ?? {}), ...(patient ? { patient } : {}) }
        : data;
    await db.query(
      'INSERT INTO webhook_deliveries (clinic_id,webhook_id,event_id,event_type,payload) VALUES ($1,$2,$3,$4,$5)',
      [clinicId, h.id, eventId, type, JSON.stringify(payload)],
    );
  }
}

/** `t=<unix>,v1=<hex>`: HMAC-SHA256 over `${t}.${body}` (timestamp included so captured requests cannot be replayed later). */
export function signWebhook(
  secret: string,
  body: string,
  t = Math.floor(Date.now() / 1000),
): string {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

export function verifyWebhookSignature(
  secret: string,
  body: string,
  header: string | undefined,
  toleranceSec = 300,
  nowSec = Math.floor(Date.now() / 1000),
): boolean {
  const m = (header ?? '').match(/^t=(\d+),v1=([0-9a-f]{64})$/);
  if (!m || Math.abs(nowSec - Number(m[1])) > toleranceSec) return false;
  const want = Buffer.from(createHmac('sha256', secret).update(`${m[1]}.${body}`).digest('hex'));
  return timingSafeEqual(want, Buffer.from(m[2]));
}

const PRIVATE = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^0\./,
  /^::1$/,
  /^fc|^fd/i,
  /^fe80/i,
  /^::ffff:(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i,
];

/** Webhook targets must be public https URLs: a clinic must not be able to aim our server at internal addresses. */
export async function assertPublicUrl(raw: string, env = process.env): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('Not a valid URL');
  }
  const allowHttp = env.WEBHOOKS_ALLOW_HTTP === 'true';
  if (u.protocol !== 'https:' && !(allowHttp && u.protocol === 'http:'))
    throw new Error('Webhook URLs must use https');
  if (u.username || u.password) throw new Error('URLs with credentials are not allowed');
  if (env.WEBHOOKS_ALLOW_PRIVATE === 'true') return u;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (!addrs.length || addrs.some((a) => PRIVATE.some((r) => r.test(a))))
    throw new Error('Webhook URL must point to a public address');
  return u;
}

const MAX_ATTEMPTS = 8;

/** Send due webhook deliveries with retries (30s, 60s, 2m, ... up to 8 tries). Returns the number delivered. */
export async function deliverWebhooks(
  pool: pg.Pool,
  log: (m: string, e?: unknown) => void = () => {},
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const due = (await pool.query('SELECT id, clinic_id FROM due_webhook_deliveries(100)')).rows;
  let sent = 0;
  for (const d of due) {
    await withClinic(pool, d.clinic_id, async (db) => {
      const row = (
        await db.query(
          "SELECT * FROM webhook_deliveries WHERE id=$1 AND status='pending' FOR UPDATE SKIP LOCKED",
          [d.id],
        )
      ).rows[0];
      if (!row) return;
      const hook = (await db.query('SELECT * FROM webhooks WHERE id=$1', [row.webhook_id])).rows[0];
      if (!hook || !hook.active) {
        await db.query(
          "UPDATE webhook_deliveries SET status='failed', last_error='webhook disabled or deleted' WHERE id=$1",
          [d.id],
        );
        return;
      }
      const body = JSON.stringify({
        id: row.event_id,
        type: row.event_type,
        created_at: row.created_at,
        clinic_id: d.clinic_id,
        data: row.payload,
      });
      let status: number | null = null,
        error: string | null = null;
      try {
        const url = await assertPublicUrl(hook.url);
        const res = await fetchImpl(url, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(8000),
          headers: {
            'content-type': 'application/json',
            'x-sahayak-event': row.event_type,
            'x-sahayak-delivery': row.id,
            'x-sahayak-signature': signWebhook(hook.secret, body),
          },
          body,
        });
        status = res.status;
        if (!res.ok) error = `HTTP ${res.status}`;
      } catch (e) {
        error = String((e as Error).message).slice(0, 200);
      }
      if (!error) {
        await db.query(
          "UPDATE webhook_deliveries SET status='sent', attempts=attempts+1, last_http_status=$2, delivered_at=now(), last_error=NULL WHERE id=$1",
          [d.id, status],
        );
        sent++;
        return;
      }
      log(`webhook delivery failed (${row.event_type})`, error);
      const attempts = row.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await db.query(
          "UPDATE webhook_deliveries SET status='failed', attempts=$2, last_error=$3, last_http_status=$4 WHERE id=$1",
          [d.id, attempts, error, status],
        );
        await db.query(
          "INSERT INTO flags (clinic_id,kind,severity,summary) VALUES ($1,'system','normal',$2)",
          [
            d.clinic_id,
            `Integration problem: events to ${new URL(hook.url).host} keep failing (${error}). Check the endpoint on the Integrations page.`,
          ],
        );
      } else {
        await db.query(
          'UPDATE webhook_deliveries SET attempts=$2, last_error=$3, last_http_status=$4, next_attempt_at=now() + make_interval(secs => $5) WHERE id=$1',
          [d.id, attempts, error, status, 30 * 2 ** (attempts - 1)],
        );
      }
    });
  }
  return sent;
}
