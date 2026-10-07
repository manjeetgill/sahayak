import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { defineTool, ToolError } from './registry';
import { assertPublicUrl, emitWebhook, WEBHOOK_EVENTS } from '../webhooks';
import {
  assertOwn,
  ensureConversation,
  hasConsent,
  storeMessage,
  deliver,
  clinicToday,
} from './common';

const ADMIN = ['staff:admin'];
const STAFF = ['staff:doctor', 'staff:receptionist'];
const EventEnum = z.enum(WEBHOOK_EVENTS);

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');
const actorUser = (a: any) => (a.kind === 'staff' ? a.userId : null);

export const createApiKey = defineTool({
  name: 'create_api_key',
  description:
    'Create an API key for the public API. The key is shown once and cannot be recovered.',
  module: 'core',
  scope: 'admin',
  input: z.object({
    name: z.string().trim().min(1).max(60),
    scope: z.enum(['read', 'write', 'admin']),
  }),
  allow: ADMIN,
  auditOutput: (o: any) => ({ id: o.id, prefix: o.prefix }), // never log the key
  async run({ db, ctx }, i) {
    const prefix = randomBytes(4).toString('hex');
    const key = `shy_${prefix}_${randomBytes(16).toString('hex')}`;
    const row = (
      await db.query(
        'INSERT INTO api_keys (clinic_id,name,prefix,key_hash,scopes,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [ctx.clinicId, i.name, prefix, hashKey(key), [i.scope], actorUser(ctx.actor)],
      )
    ).rows[0];
    return { id: row.id as string, prefix, key, scope: i.scope };
  },
});

export const listApiKeys = defineTool({
  name: 'list_api_keys',
  description: 'API keys (never the secret).',
  module: 'core',
  scope: 'admin',
  input: z.object({}),
  allow: ADMIN,
  async run({ db }) {
    return {
      keys: (
        await db.query(
          'SELECT id, name, prefix, scopes, created_at, last_used_at, revoked_at FROM api_keys ORDER BY created_at DESC',
        )
      ).rows,
    };
  },
});

export const revokeApiKey = defineTool({
  name: 'revoke_api_key',
  description: 'Revoke an API key immediately.',
  module: 'core',
  scope: 'admin',
  input: z.object({ id: z.string().uuid() }),
  allow: ADMIN,
  async run({ db }, { id }) {
    const u = await db.query(
      'UPDATE api_keys SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL RETURNING id',
      [id],
    );
    if (!u.rowCount) throw new ToolError('not_found', 'Key not found or already revoked', 404);
    return { ok: true };
  },
});

const hookInput = z.object({
  url: z.string().url().max(500),
  events: z.array(EventEnum).min(1).max(WEBHOOK_EVENTS.length),
  level: z.enum(['minimal', 'full']).default('minimal'),
});

export const createWebhook = defineTool({
  name: 'create_webhook',
  description:
    'Subscribe a URL to clinic events. level "minimal" sends ids only; "full" adds patient name/phone (and message text for message.received).',
  module: 'core',
  scope: 'admin',
  input: hookInput,
  allow: [...ADMIN, 'api'],
  auditOutput: (o: any) => ({ id: o.id }), // never log the signing secret
  async run({ db, ctx }, i) {
    try {
      await assertPublicUrl(i.url);
    } catch (e) {
      throw new ToolError('invalid_url', (e as Error).message);
    }
    const secret = `whsec_${randomBytes(24).toString('hex')}`;
    const row = (
      await db.query(
        'INSERT INTO webhooks (clinic_id,url,secret,events,level,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [ctx.clinicId, i.url, secret, i.events, i.level, actorUser(ctx.actor)],
      )
    ).rows[0];
    return { id: row.id as string, secret };
  },
});

export const updateWebhook = defineTool({
  name: 'update_webhook',
  description: 'Change events, level or on/off for a webhook.',
  module: 'core',
  scope: 'admin',
  input: z.object({
    id: z.string().uuid(),
    events: z.array(EventEnum).min(1).optional(),
    level: z.enum(['minimal', 'full']).optional(),
    active: z.boolean().optional(),
  }),
  allow: ADMIN,
  async run({ db }, i) {
    const u = await db.query(
      `UPDATE webhooks SET events=COALESCE($2,events), level=COALESCE($3,level), active=COALESCE($4,active),
         disabled_reason = CASE WHEN $4 IS TRUE THEN NULL ELSE disabled_reason END WHERE id=$1 RETURNING id`,
      [i.id, i.events ?? null, i.level ?? null, i.active ?? null],
    );
    if (!u.rowCount) throw new ToolError('not_found', 'Webhook not found', 404);
    return { ok: true };
  },
});

export const deleteWebhook = defineTool({
  name: 'delete_webhook',
  description: 'Delete a webhook subscription.',
  module: 'core',
  scope: 'admin',
  input: z.object({ id: z.string().uuid() }),
  allow: [...ADMIN, 'api'],
  async run({ db }, { id }) {
    const d = await db.query('DELETE FROM webhooks WHERE id=$1 RETURNING id', [id]);
    if (!d.rowCount) throw new ToolError('not_found', 'Webhook not found', 404);
    return { ok: true };
  },
});

export const listWebhooks = defineTool({
  name: 'list_webhooks',
  description: 'Webhooks and their recent delivery health (never the secret).',
  module: 'core',
  scope: 'admin',
  input: z.object({}),
  allow: ADMIN,
  async run({ db }) {
    const hooks = (
      await db.query(
        `SELECT w.id, w.url, w.events, w.level, w.active, w.created_at,
           (SELECT count(*)::int FROM webhook_deliveries d WHERE d.webhook_id=w.id AND d.status='sent' AND d.created_at > now() - interval '7 days') AS sent_7d,
           (SELECT count(*)::int FROM webhook_deliveries d WHERE d.webhook_id=w.id AND d.status='failed' AND d.created_at > now() - interval '7 days') AS failed_7d,
           (SELECT count(*)::int FROM webhook_deliveries d WHERE d.webhook_id=w.id AND d.status='pending') AS pending
           FROM webhooks w ORDER BY w.created_at DESC`,
      )
    ).rows;
    return { hooks };
  },
});

export const listWebhookDeliveries = defineTool({
  name: 'list_webhook_deliveries',
  description: 'Most recent deliveries for a webhook.',
  module: 'core',
  scope: 'admin',
  input: z.object({ webhookId: z.string().uuid() }),
  allow: ADMIN,
  async run({ db }, { webhookId }) {
    return {
      deliveries: (
        await db.query(
          'SELECT id, event_type, status, attempts, last_http_status, last_error, created_at, delivered_at FROM webhook_deliveries WHERE webhook_id=$1 ORDER BY created_at DESC LIMIT 30',
          [webhookId],
        )
      ).rows,
    };
  },
});

export const testWebhook = defineTool({
  name: 'test_webhook',
  description: 'Queue a test "ping" event to every active webhook.',
  module: 'core',
  scope: 'admin',
  input: z.object({}),
  allow: ADMIN,
  async run({ db, ctx }) {
    await db.query(
      "UPDATE webhooks SET events = array_append(events,'ping') WHERE active AND NOT 'ping' = ANY(events)",
    );
    await emitWebhook(db, ctx.clinicId, 'ping', { message: 'Hello from Sahayak' });
    return { ok: true };
  },
});

// ---------- read/write helpers for the public API ----------

export const listAppointments = defineTool({
  name: 'list_appointments',
  description: 'Appointments for a day (default today), optionally one doctor.',
  module: 'appointments',
  scope: 'read',
  input: z.object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    doctorId: z.string().uuid().optional(),
  }),
  allow: [...STAFF, 'api'],
  async run({ db, ctx }, i) {
    const date = i.date ?? (await clinicToday(db, ctx.clinicId)).date;
    const rows = (
      await db.query(
        `SELECT a.id, a.doctor_id, a.patient_id, p.name AS patient_name, p.phone AS patient_phone, a.starts_at, a.ends_at, a.status, a.reason, a.source
           FROM appointments a LEFT JOIN patients p ON p.id=a.patient_id
          WHERE (a.starts_at AT TIME ZONE (SELECT timezone FROM clinics WHERE id=$1))::date = $2::date AND ($3::uuid IS NULL OR a.doctor_id=$3)
          ORDER BY a.starts_at`,
        [ctx.clinicId, date, i.doctorId ?? null],
      )
    ).rows;
    return { date, appointments: rows };
  },
});

export const getQueueOverview = defineTool({
  name: 'get_queue_overview',
  description: "Today's queue.",
  module: 'queue',
  scope: 'read',
  input: z.object({}),
  allow: [...STAFF, 'api'],
  async run({ db, ctx }) {
    const { date } = await clinicToday(db, ctx.clinicId);
    const rows = (
      await db.query(
        `SELECT q.id, q.doctor_id, q.patient_id, p.name AS patient_name, q.token_number, q.status, q.checked_in_at, q.called_at
           FROM queue_entries q JOIN patients p ON p.id=q.patient_id WHERE q.queue_date=$1 ORDER BY q.position_key`,
        [date],
      )
    ).rows;
    return { date, queue: rows };
  },
});

export const messagePatient = defineTool({
  name: 'message_patient',
  description:
    'Send a WhatsApp message to a patient. Requires their messaging consent. Free text only reaches them inside the WhatsApp 24-hour window; approved templates come with the real WhatsApp provider.',
  module: 'core',
  scope: 'write',
  input: z.object({ patientId: z.string().uuid(), text: z.string().trim().min(1).max(1000) }),
  allow: ['staff:receptionist', 'api'],
  async run(r, { patientId, text }) {
    const { db, ctx } = r;
    assertOwn(ctx, patientId);
    const p = (await db.query('SELECT id, phone, language FROM patients WHERE id=$1', [patientId]))
      .rows[0];
    if (!p) throw new ToolError('not_found', 'Patient not found', 404);
    if (!(await hasConsent(db, patientId, 'whatsapp_messaging')))
      throw new ToolError('no_consent', 'Patient has not consented to messages');
    const conv = await ensureConversation(db, ctx.clinicId, p.phone, patientId, p.language);
    const sender =
      ctx.actor.kind === 'api' ? `api:${ctx.actor.keyId}` : `staff:${(ctx.actor as any).userId}`;
    await storeMessage(db, ctx.clinicId, conv.id, 'out', sender, text);
    await deliver(r, { to: p.phone, text, lang: p.language });
    r.emit({ type: 'conversation_updated', conversationId: conv.id });
    return { ok: true };
  },
});

export const integrationTools = [
  createApiKey,
  listApiKeys,
  revokeApiKey,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  listWebhooks,
  listWebhookDeliveries,
  testWebhook,
  listAppointments,
  getQueueOverview,
  messagePatient,
];
