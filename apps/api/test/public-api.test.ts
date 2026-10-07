import { createServer, type Server } from 'node:http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { addPatient, createTestClinic, dropTestClinic, hashPassword, makePool } from '@sahayak/db';
import { EventBus, deliverWebhooks, verifyWebhookSignature, signWebhook } from '@sahayak/core';
import { LlmGate } from '@sahayak/agents';
import { buildApp } from '../src/app';

const admin = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
const pool = makePool();
let A: Awaited<ReturnType<typeof createTestClinic>>,
  B: Awaited<ReturnType<typeof createTestClinic>>;
let app: Awaited<ReturnType<typeof buildApp>>;
const tok: Record<string, string> = {};
const received: { headers: any; body: string }[] = [];
let respond = 200;
let server: Server,
  hookUrl = '';

beforeAll(async () => {
  process.env.WEBHOOKS_ALLOW_HTTP = 'true';
  process.env.WEBHOOKS_ALLOW_PRIVATE = 'true';
  await admin.connect();
  A = await createTestClinic(admin, 'pubA');
  B = await createTestClinic(admin, 'pubB');
  const pw = await hashPassword('pw-test-1234');
  for (const [cl, doc, tag] of [
    [A, A.doctorIds[0], 'a'],
    [B, B.doctorIds[0], 'b'],
  ] as const) {
    await admin.query(
      "INSERT INTO staff_users (clinic_id,email,password_hash,name,role,doctor_id) VALUES ($1,$2,$3,'D','admin',$4),($1,$5,$3,'R','receptionist',NULL)",
      [
        cl.clinicId,
        `d${tag}-${cl.slug}@t.in`.toLowerCase(),
        pw,
        doc,
        `r${tag}-${cl.slug}@t.in`.toLowerCase(),
      ],
    );
  }
  app = await buildApp({ pool, bus: new EventBus(''), gate: new LlmGate(null), jwtSecret: 't' });
  for (const [k, cl, tag, role] of [
    ['docA', A, 'a', 'd'],
    ['recA', A, 'a', 'r'],
    ['docB', B, 'b', 'd'],
  ] as const)
    tok[k] = (
      await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: `${role}${tag}-${cl.slug}@t.in`.toLowerCase(), password: 'pw-test-1234' },
      })
    ).json().token;
  server = createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      received.push({ headers: req.headers, body: b });
      res.statusCode = respond;
      res.end('ok');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  hookUrl = `http://127.0.0.1:${(server.address() as any).port}/hook`;
});
afterAll(async () => {
  delete process.env.WEBHOOKS_ALLOW_HTTP;
  delete process.env.WEBHOOKS_ALLOW_PRIVATE;
  server.close();
  await dropTestClinic(admin, A.clinicId);
  await dropTestClinic(admin, B.clinicId);
  await admin.end();
  await pool.end();
  await app.close();
});
const h = (k: string) => ({ authorization: `Bearer ${tok[k]}` });
const mkKey = async (scope: string, as = 'docA') =>
  (
    await app.inject({
      method: 'POST',
      url: '/staff/integrations/keys',
      headers: h(as),
      payload: { name: `k-${scope}`, scope },
    })
  ).json();
const api = (key: string, method: string, url: string, payload?: object) =>
  app.inject({ method: method as any, url, headers: { authorization: `Bearer ${key}` }, payload });
const day = () => new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

describe('API keys', () => {
  let read: any, write: any, admin_: any;
  it('only an admin can create keys; the secret is shown once', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/staff/integrations/keys',
          headers: h('recA'),
          payload: { name: 'x', scope: 'read' },
        })
      ).statusCode,
    ).toBe(403);
    read = await mkKey('read');
    write = await mkKey('write');
    admin_ = await mkKey('admin');
    expect(read.key).toMatch(/^shy_[0-9a-f]{8}_[0-9a-f]{32}$/);
    const list = (await app.inject({ url: '/staff/integrations', headers: h('docA') })).json();
    expect(list.keys.length).toBe(3);
    expect(JSON.stringify(list)).not.toContain(read.key);
    expect(JSON.stringify(list)).not.toContain('key_hash');
    expect(
      (await admin.query('SELECT key_hash FROM api_keys WHERE id=$1', [read.id])).rows[0].key_hash,
    ).not.toContain(read.key.slice(-32));
  });
  it('rejects missing, malformed and wrong keys', async () => {
    expect((await app.inject({ url: '/v1/doctors' })).statusCode).toBe(401);
    expect((await api('shy_bad', 'GET', '/v1/doctors')).statusCode).toBe(401);
    expect(
      (await api(`shy_${read.prefix}_${'0'.repeat(32)}`, 'GET', '/v1/doctors')).statusCode,
    ).toBe(401);
  });
  it('scopes: read can read, not write; write cannot manage webhooks', async () => {
    expect((await api(read.key, 'GET', '/v1/doctors')).statusCode).toBe(200);
    const body = {
      doctorId: A.doctorIds[0],
      startsAt: new Date().toISOString(),
      patient: { phone: '9822200001', name: 'X' },
      consentVisitData: true,
    };
    expect((await api(read.key, 'POST', '/v1/appointments', body)).statusCode).toBe(403);
    expect(
      (await api(write.key, 'POST', '/v1/webhooks', { url: hookUrl, events: ['ping'] })).statusCode,
    ).toBe(403);
    expect(
      (await api(admin_.key, 'POST', '/v1/webhooks', { url: hookUrl, events: ['ping'] }))
        .statusCode,
    ).toBe(200);
  });
  it('a key only ever sees its own clinic', async () => {
    const docs = (await api(read.key, 'GET', '/v1/doctors')).json();
    expect(docs.map((d: any) => d.id).sort()).toEqual([...A.doctorIds].sort());
    const kb = await mkKey('read', 'docB');
    expect((await api(kb.key, 'GET', '/v1/doctors')).json().map((d: any) => d.id)).not.toContain(
      A.doctorIds[0],
    );
    expect((await api(kb.key, 'GET', `/v1/slots?doctorId=${A.doctorIds[0]}`)).statusCode).toBe(404);
  });
  it('revoking stops the key immediately; the audit log never holds the secret', async () => {
    const k = await mkKey('read');
    expect((await api(k.key, 'GET', '/v1/doctors')).statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/staff/integrations/keys/${k.id}`,
          headers: h('docA'),
        })
      ).statusCode,
    ).toBe(200);
    expect((await api(k.key, 'GET', '/v1/doctors')).statusCode).toBe(401);
    const all = JSON.stringify(
      (
        await admin.query('SELECT input, output FROM agent_actions WHERE clinic_id=$1', [
          A.clinicId,
        ])
      ).rows,
    );
    expect(all).not.toContain(k.key);
    expect(all).not.toContain(read.key);
  });
  it('is rate limited per key', async () => {
    const k = await mkKey('read');
    let last = 200;
    for (let i = 0; i < 125; i++) last = (await api(k.key, 'GET', '/v1/doctors')).statusCode;
    expect(last).toBe(429);
  });
  it('serves an OpenAPI description', async () => {
    const spec = (await app.inject({ url: '/v1/openapi.json' })).json();
    expect(Object.keys(spec.paths)).toContain('/v1/appointments');
  });
});

describe('booking through the API', () => {
  let key: string;
  beforeAll(async () => {
    key = (await mkKey('write')).key;
  });
  it('lists slots, books for a new patient only with consent, and shows it in the day list', async () => {
    const slots = (
      await api(
        key,
        'GET',
        `/v1/slots?doctorId=${A.doctorIds[0]}&date=${day()}&from=10:00&to=11:00&count=2`,
      )
    ).json().slots;
    expect(slots).toHaveLength(2);
    const body = {
      doctorId: A.doctorIds[0],
      startsAt: slots[0],
      reason: 'check-up',
      patient: { phone: '9822200002', name: 'Api Patient' },
    };
    const no = await api(key, 'POST', '/v1/appointments', body);
    expect(no.statusCode).toBe(400);
    expect(no.json().error).toBe('consent_required');
    const ok = await api(key, 'POST', '/v1/appointments', { ...body, consentVisitData: true });
    expect(ok.statusCode).toBe(200);
    const id = ok.json().appointmentId;
    expect(
      (await admin.query('SELECT source FROM appointments WHERE id=$1', [id])).rows[0].source,
    ).toBe('api');
    expect(
      (
        await admin.query("SELECT 1 FROM consents WHERE patient_id=$1 AND purpose='visit_data'", [
          ok.json().patientId,
        ])
      ).rowCount,
    ).toBe(1);
    const list = (await api(key, 'GET', `/v1/appointments?date=${slots[0].slice(0, 10)}`)).json();
    expect(JSON.stringify(list)).toContain(id);
    expect(
      (await api(key, 'POST', '/v1/appointments', { ...body, consentVisitData: true })).json()
        .error,
    ).toBe('slot_taken');
    const moved = await api(key, 'POST', `/v1/appointments/${id}/reschedule`, {
      newStartsAt: slots[1],
    });
    expect(moved.statusCode).toBe(200);
    expect((await api(key, 'POST', `/v1/appointments/${id}/cancel`)).statusCode).toBe(200);
    expect(
      (await admin.query('SELECT status FROM appointments WHERE id=$1', [id])).rows[0].status,
    ).toBe('cancelled');
  });
  it("cannot touch another clinic's appointment", async () => {
    const kb = (await mkKey('write', 'docB')).key;
    const appt = (
      await admin.query('SELECT id FROM appointments WHERE clinic_id=$1 LIMIT 1', [A.clinicId])
    ).rows[0];
    if (appt)
      expect((await api(kb, 'POST', `/v1/appointments/${appt.id}/cancel`)).statusCode).toBe(404);
  });
  it('messages only patients who consented', async () => {
    await addPatient(admin, A.clinicId, 'Chatty', '+919822200010');
    await addPatient(admin, A.clinicId, 'Silent', '+919822200011', { whatsapp: false });
    expect(
      (await api(key, 'POST', '/v1/messages', { phone: '9822200010', text: 'Hello from n8n' }))
        .statusCode,
    ).toBe(200);
    expect(
      (await api(key, 'POST', '/v1/messages', { phone: '9822200011', text: 'Hello' })).json().error,
    ).toBe('no_consent');
    expect(
      (await api(key, 'POST', '/v1/messages', { phone: '9822200099', text: 'Hello' })).statusCode,
    ).toBe(404);
    const body = (
      await admin.query(
        "SELECT body FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.contact='+919822200010'",
      )
    ).rows[0].body;
    expect(body).toBe('Hello from n8n');
  });
});

describe('outbound webhooks', () => {
  let hook: { id: string; secret: string };
  const ev = () => received.map((r) => JSON.parse(r.body));
  it('private and non-https targets are refused by default', async () => {
    delete process.env.WEBHOOKS_ALLOW_HTTP;
    delete process.env.WEBHOOKS_ALLOW_PRIVATE;
    for (const url of [
      'http://example.com/x',
      'https://127.0.0.1/x',
      'https://10.0.0.5/x',
      'https://169.254.169.254/latest',
      'https://[::1]/x',
      'ftp://example.com',
    ]) {
      const r = await app.inject({
        method: 'POST',
        url: '/staff/integrations/webhooks',
        headers: h('docA'),
        payload: { url, events: ['ping'] },
      });
      expect([url, r.statusCode, r.json().error]).toEqual([
        url,
        400,
        r.json().error === 'invalid_input' ? 'invalid_input' : 'invalid_url',
      ]);
    }
    process.env.WEBHOOKS_ALLOW_HTTP = 'true';
    process.env.WEBHOOKS_ALLOW_PRIVATE = 'true';
  });
  it('events are signed, carry ids only at level minimal, and can be verified', async () => {
    hook = (
      await app.inject({
        method: 'POST',
        url: '/staff/integrations/webhooks',
        headers: h('docA'),
        payload: {
          url: hookUrl,
          events: ['appointment.booked', 'patient.checked_in', 'patient.erased'],
          level: 'minimal',
        },
      })
    ).json();
    expect(hook.secret).toMatch(/^whsec_/);
    const key = (await mkKey('write')).key;
    const slot = (
      await api(key, 'GET', `/v1/slots?doctorId=${A.doctorIds[1]}&date=${day()}&count=1`)
    ).json().slots[0];
    await api(key, 'POST', '/v1/appointments', {
      doctorId: A.doctorIds[1],
      startsAt: slot,
      patient: { phone: '9822200020', name: 'Hook Patient' },
      consentVisitData: true,
    });
    received.length = 0;
    expect(await deliverWebhooks(pool)).toBeGreaterThanOrEqual(1);
    const r = received.find((x) => JSON.parse(x.body).type === 'appointment.booked')!;
    expect(r).toBeTruthy();
    expect(verifyWebhookSignature(hook.secret, r.body, r.headers['x-sahayak-signature'])).toBe(
      true,
    );
    expect(verifyWebhookSignature('whsec_wrong', r.body, r.headers['x-sahayak-signature'])).toBe(
      false,
    );
    expect(
      verifyWebhookSignature(hook.secret, r.body + ' ', r.headers['x-sahayak-signature']),
    ).toBe(false); // tampered
    const old = signWebhook(hook.secret, r.body, Math.floor(Date.now() / 1000) - 3600);
    expect(verifyWebhookSignature(hook.secret, r.body, old)).toBe(false); // replayed an hour later
    const e = JSON.parse(r.body);
    expect(e.data).toMatchObject({ doctorId: A.doctorIds[1], source: 'api' });
    expect(JSON.stringify(e)).not.toMatch(/Hook Patient|9822200020/); // minimal = no personal data
  });
  it('only subscribed events are sent; level full adds the patient', async () => {
    await app.inject({
      method: 'PATCH',
      url: `/staff/integrations/webhooks/${hook.id}`,
      headers: h('docA'),
      payload: { level: 'full' },
    });
    received.length = 0;
    const p = await app.inject({
      method: 'POST',
      url: `/public/${A.slug}/checkin`,
      payload: {
        name: 'Full Level',
        phone: '9822200030',
        doctorId: A.doctorIds[0],
        consent: { visit_data: true },
      },
    });
    expect(p.statusCode).toBe(200);
    await app.inject({
      method: 'POST',
      url: `/sim/${A.slug}/message`,
      payload: { from: '9822200030', text: 'what are your timings' },
    }); // message.received not subscribed
    await deliverWebhooks(pool);
    const types = ev().map((x) => x.type);
    expect(types).toContain('patient.checked_in');
    expect(types).not.toContain('message.received');
    const ci = ev().find((x) => x.type === 'patient.checked_in');
    expect(ci.data.patient).toMatchObject({ name: 'Full Level', phone: '+919822200030' });
  });
  it('erasing a patient notifies connected systems so they can delete too', async () => {
    const pid = (await admin.query("SELECT id FROM patients WHERE phone='+919822200030'")).rows[0]
      .id;
    const recKey = await app.inject({
      method: 'POST',
      url: `/staff/patients/${pid}/erase`,
      headers: h('recA'),
    });
    expect(recKey.statusCode).toBe(200);
    received.length = 0;
    await deliverWebhooks(pool);
    const er = ev().find((x) => x.type === 'patient.erased');
    expect(er.data).toEqual({ patientId: pid, partial: false });
  });
  it('failures are retried with backoff, then reported to the receptionist', async () => {
    respond = 500;
    await app.inject({ method: 'POST', url: '/staff/integrations/test', headers: h('docA') });
    await deliverWebhooks(pool);
    const d = (
      await admin.query(
        "SELECT attempts, status, next_attempt_at > now() AS later FROM webhook_deliveries WHERE event_type='ping' ORDER BY created_at DESC LIMIT 1",
      )
    ).rows[0];
    expect(d).toMatchObject({ attempts: 1, status: 'pending', later: true });
    for (let i = 0; i < 8; i++) {
      await admin.query(
        "UPDATE webhook_deliveries SET next_attempt_at=now() WHERE status='pending'",
      );
      await deliverWebhooks(pool);
    }
    expect(
      (
        await admin.query(
          "SELECT status FROM webhook_deliveries WHERE event_type='ping' ORDER BY created_at DESC LIMIT 1",
        )
      ).rows[0].status,
    ).toBe('failed');
    const flags = (await app.inject({ url: '/staff/flags', headers: h('recA') })).json();
    expect(flags.some((f: any) => /Integration problem/.test(f.summary))).toBe(true);
    respond = 200;
  });
  it('shows delivery health; a disabled webhook gets nothing', async () => {
    await admin.query('DELETE FROM webhooks WHERE clinic_id=$1 AND id<>$2', [A.clinicId, hook.id]); // the scope test left another subscriber
    const list = (await app.inject({ url: '/staff/integrations', headers: h('docA') })).json();
    expect(list.hooks[0]).toMatchObject({ id: hook.id });
    await app.inject({
      method: 'PATCH',
      url: `/staff/integrations/webhooks/${hook.id}`,
      headers: h('docA'),
      payload: { active: false },
    });
    received.length = 0;
    await app.inject({ method: 'POST', url: '/staff/integrations/test', headers: h('docA') });
    await deliverWebhooks(pool);
    expect(received).toHaveLength(0);
  });
  it('another clinic never receives our events', async () => {
    const hb = (
      await app.inject({
        method: 'POST',
        url: '/staff/integrations/webhooks',
        headers: h('docB'),
        payload: { url: hookUrl, events: ['appointment.booked', 'patient.checked_in'] },
      })
    ).json();
    expect(hb.id).toBeTruthy();
    received.length = 0;
    await app.inject({
      method: 'POST',
      url: `/public/${A.slug}/checkin`,
      payload: {
        name: 'Only A',
        phone: '9822200040',
        doctorId: A.doctorIds[0],
        consent: { visit_data: true },
      },
    });
    await app.inject({
      method: 'PATCH',
      url: `/staff/integrations/webhooks/${hook.id}`,
      headers: h('docA'),
      payload: { active: true },
    });
    await deliverWebhooks(pool);
    const rows = (
      await admin.query('SELECT clinic_id FROM webhook_deliveries WHERE webhook_id=$1', [hb.id])
    ).rows;
    expect(rows).toHaveLength(0);
  });
});
