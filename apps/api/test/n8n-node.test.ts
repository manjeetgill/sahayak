import { createServer, type Server } from 'node:http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { createTestClinic, dropTestClinic, hashPassword, makePool } from '@sahayak/db';
import { EventBus, deliverWebhooks } from '@sahayak/core';
import { LlmGate } from '@sahayak/agents';
import { buildApp } from '../src/app';
import { Sahayak } from '../../../packages/n8n-nodes-sahayak/nodes/Sahayak/Sahayak.node';
import { SahayakTrigger } from '../../../packages/n8n-nodes-sahayak/nodes/SahayakTrigger/SahayakTrigger.node';

/**
 * Drives the real node classes with a stand-in for the n8n runtime that sends their HTTP calls to our real API.
 * Proves the node <-> API contract. It does not run inside n8n itself.
 */
const admin = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
const pool = makePool();
let A: Awaited<ReturnType<typeof createTestClinic>>;
let app: Awaited<ReturnType<typeof buildApp>>;
let adminKey = '';
let docToken = '';
let server: Server,
  hookPath = '';
const hookCalls: { headers: any; body: string }[] = [];
let triggerHandler: ((raw: string, headers: any) => Promise<any>) | null = null;

const http = (key: string) => async (_t: string, o: any) => {
  const url = new URL(o.url);
  const qs = o.qs ? '?' + new URLSearchParams(o.qs as any).toString() : '';
  const r = await app.inject({
    method: o.method,
    url: url.pathname + qs,
    headers: { authorization: `Bearer ${key}` },
    payload: o.body,
  });
  if (r.statusCode >= 400) throw new Error(`HTTP ${r.statusCode}: ${r.body}`);
  return r.json();
};
const ctx = (params: Record<string, any>, key: string, extra: object = {}) => ({
  getInputData: () => [{ json: {} }],
  getCredentials: async () => ({ baseUrl: 'http://api.test', apiKey: key }),
  getNodeParameter: (n: string) => {
    if (!(n in params)) throw new Error(`no param ${n}`);
    return params[n];
  },
  continueOnFail: () => false,
  getNode: () => ({ name: 'Sahayak' }),
  helpers: { httpRequestWithAuthentication: http(key), returnJsonArray: (x: any) => [{ json: x }] },
  ...extra,
});

beforeAll(async () => {
  process.env.WEBHOOKS_ALLOW_HTTP = 'true';
  process.env.WEBHOOKS_ALLOW_PRIVATE = 'true';
  await admin.connect();
  A = await createTestClinic(admin, 'n8n');
  await admin.query(
    "INSERT INTO staff_users (clinic_id,email,password_hash,name,role,doctor_id) VALUES ($1,$2,$3,'D','admin',$4)",
    [A.clinicId, `d-${A.slug}@t.in`, await hashPassword('pw-test-1234'), A.doctorIds[0]],
  );
  app = await buildApp({ pool, bus: new EventBus(''), gate: new LlmGate(null), jwtSecret: 't' });
  docToken = (
    await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: `d-${A.slug}@t.in`, password: 'pw-test-1234' },
    })
  ).json().token;
  adminKey = (
    await app.inject({
      method: 'POST',
      url: '/staff/integrations/keys',
      headers: { authorization: `Bearer ${docToken}` },
      payload: { name: 'n8n', scope: 'admin' },
    })
  ).json().key;
  server = createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', async () => {
      hookCalls.push({ headers: req.headers, body: b });
      const out = triggerHandler ? await triggerHandler(b, req.headers) : null;
      res.statusCode = out?.status ?? 200;
      res.end('ok');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  hookPath = `http://127.0.0.1:${(server.address() as any).port}/webhook/n8n`;
});
afterAll(async () => {
  delete process.env.WEBHOOKS_ALLOW_HTTP;
  delete process.env.WEBHOOKS_ALLOW_PRIVATE;
  server.close();
  await dropTestClinic(admin, A.clinicId);
  await admin.end();
  await pool.end();
  await app.close();
});

describe('Sahayak node against the real API', () => {
  const run = async (params: Record<string, any>) =>
    (await new Sahayak().execute.call(ctx(params, adminKey) as any))[0].map((x) => x.json as any);
  it('lists doctors, finds slots, books, lists the day, reschedules and cancels', async () => {
    const docs = await run({ resource: 'doctor', operation: 'getAll' });
    expect(docs.map((d: any) => d.name)).toContain('Dr. Test One');
    const slots = await run({
      resource: 'slot',
      operation: 'getAll',
      doctorId: A.doctorIds[0],
      date: '',
      from: '10:00',
      to: '12:00',
      count: 2,
    });
    expect(slots).toHaveLength(2);
    const booked = (
      await run({
        resource: 'appointment',
        operation: 'book',
        doctorId: A.doctorIds[0],
        startsAt: slots[0].startsAt,
        phone: '9833300001',
        name: 'N8n Patient',
        consentVisitData: true,
        reason: 'via n8n',
      })
    )[0];
    expect(booked.appointmentId).toBeTruthy();
    const day = await run({
      resource: 'appointment',
      operation: 'getAll',
      doctorId: '',
      date: slots[0].startsAt.slice(0, 10),
    });
    expect(
      day.some((a: any) => a.id === booked.appointmentId && a.patient_name === 'N8n Patient'),
    ).toBe(true);
    await run({
      resource: 'appointment',
      operation: 'reschedule',
      appointmentId: booked.appointmentId,
      newStartsAt: slots[1].startsAt,
    });
    await run({
      resource: 'appointment',
      operation: 'cancel',
      appointmentId: booked.appointmentId,
    });
    expect(
      (await admin.query('SELECT status FROM appointments WHERE id=$1', [booked.appointmentId]))
        .rows[0].status,
    ).toBe('cancelled');
  });
  it('a booking for a new patient without the consent switch fails with a clear message', async () => {
    const slot = (
      await run({
        resource: 'slot',
        operation: 'getAll',
        doctorId: A.doctorIds[0],
        date: '',
        from: '',
        to: '',
        count: 1,
      })
    )[0];
    await expect(
      run({
        resource: 'appointment',
        operation: 'book',
        doctorId: A.doctorIds[0],
        startsAt: slot.startsAt,
        phone: '9833300002',
        name: 'No Consent',
        consentVisitData: false,
      }),
    ).rejects.toThrow(/consent/i);
  });
  it('reads the queue', async () => {
    await app.inject({
      method: 'POST',
      url: `/public/${A.slug}/checkin`,
      payload: {
        name: 'Queue Pt',
        phone: '9833300003',
        doctorId: A.doctorIds[0],
        consent: { visit_data: true },
      },
    });
    const q = await run({ resource: 'queue', operation: 'get' });
    expect(q.map((x: any) => x.patient_name)).toContain('Queue Pt');
  });
});

describe('Sahayak Trigger node', () => {
  const staticData: Record<string, any> = {};
  const hookCtx = (params: Record<string, any>) => ({
    getWorkflowStaticData: () => staticData,
    getCredentials: async () => ({ baseUrl: 'http://api.test', apiKey: adminKey }),
    getNodeParameter: (n: string) => params[n],
    getNodeWebhookUrl: () => hookPath,
    helpers: { httpRequestWithAuthentication: http(adminKey) },
  });
  const node = new SahayakTrigger();
  const params = { events: ['patient.checked_in'], level: 'minimal' };

  it('registers itself on activation and removes itself on deactivation', async () => {
    expect(await node.webhookMethods.default.checkExists.call(hookCtx(params) as any)).toBe(false);
    await node.webhookMethods.default.create.call(hookCtx(params) as any);
    expect(staticData.webhookId).toBeTruthy();
    expect(staticData.secret).toMatch(/^whsec_/);
    expect(await node.webhookMethods.default.checkExists.call(hookCtx(params) as any)).toBe(true);
    const rows = (
      await admin.query('SELECT url, events FROM webhooks WHERE clinic_id=$1', [A.clinicId])
    ).rows;
    expect(rows[0]).toMatchObject({ url: hookPath, events: ['patient.checked_in'] });
  });
  it('accepts real signed events from Sahayak and starts the flow', async () => {
    let started: any = null;
    triggerHandler = async (raw, headers) => {
      const res = {
        status: (c: number) => ({
          json: () => {
            started = { rejected: c };
          },
        }),
      };
      const out = await node.webhook.call({
        getRequestObject: () => ({ rawBody: Buffer.from(raw), body: JSON.parse(raw) }),
        getResponseObject: () => res,
        getHeaderData: () => headers,
        getBodyData: () => JSON.parse(raw),
        getNodeParameter: (n: string) => (params as any)[n],
        getWorkflowStaticData: () => staticData,
        helpers: { returnJsonArray: (x: any) => [{ json: x }] },
      } as any);
      started = started ?? out;
      return {};
    };
    await app.inject({
      method: 'POST',
      url: `/public/${A.slug}/checkin`,
      payload: {
        name: 'Trig Pt',
        phone: '9833300004',
        doctorId: A.doctorIds[0],
        consent: { visit_data: true },
      },
    });
    hookCalls.length = 0;
    await deliverWebhooks(pool);
    expect(hookCalls.length).toBeGreaterThanOrEqual(1);
    expect(started.workflowData[0][0].json).toMatchObject({ type: 'patient.checked_in' });
    expect(JSON.stringify(started)).not.toMatch(/Trig Pt|9833300004/); // minimal level
  });
  it('rejects forged calls to the public webhook URL', async () => {
    let res: any = null;
    const resp = {
      status: (c: number) => ({
        json: (b: any) => {
          res = { c, b };
        },
      }),
    };
    const body = JSON.stringify({ id: 'x', type: 'patient.checked_in', data: {} });
    const out = await node.webhook.call({
      getRequestObject: () => ({ rawBody: Buffer.from(body), body: JSON.parse(body) }),
      getResponseObject: () => resp,
      getHeaderData: () => ({ 'x-sahayak-signature': 't=1,v1=' + '0'.repeat(64) }),
      getBodyData: () => JSON.parse(body),
      getNodeParameter: () => params.events,
      getWorkflowStaticData: () => staticData,
      helpers: { returnJsonArray: (x: any) => [{ json: x }] },
    } as any);
    expect(res.c).toBe(401);
    expect(out).toEqual({ noWebhookResponse: true });
  });
  it('deactivating deletes the subscription', async () => {
    await node.webhookMethods.default.delete.call(hookCtx(params) as any);
    expect(
      (await admin.query('SELECT 1 FROM webhooks WHERE clinic_id=$1', [A.clinicId])).rowCount,
    ).toBe(0);
    expect(staticData.webhookId).toBeUndefined();
  });
});
