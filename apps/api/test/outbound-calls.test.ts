import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createTestClinic, dropTestClinic, makePool } from '@sahayak/db';
import { EventBus } from '@sahayak/core';
import { LlmGate } from '@sahayak/agents';
import { buildApp } from '../src/app';
const db = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL }),
  pool = makePool();
let clinic: Awaited<ReturnType<typeof createTestClinic>>,
  other: typeof clinic,
  app: Awaited<ReturnType<typeof buildApp>>;
const agent = randomUUID(),
  callId = randomUUID(),
  users: Record<string, string> = {};
let supported = false,
  fail = false,
  posts = 0;
const requests = new Map<string, any>();
const number = '+919800001111';
const auth = (role = 'admin', c = clinic) => ({
  authorization:
    'Bearer ' +
    app.jwt.sign({ uid: users[c.clinicId + role], clinicId: c.clinicId, role, name: 'Test' }),
});
const make = (id = randomUUID(), destination = number) => ({
  requestId: id,
  destination,
  ownsNumber: true,
  acceptsCharges: true,
});
const dial = (payload: any, role = 'admin', c = clinic) =>
  app.inject({
    method: 'POST',
    url: '/staff/agents/calling/outbound',
    headers: auth(role, c),
    payload,
  });
beforeAll(async () => {
  await db.connect();
  clinic = await createTestClinic(db, 'outcall');
  other = await createTestClinic(db, 'outother');
  for (const c of [clinic, other])
    for (const role of ['admin', 'doctor', 'receptionist'])
      users[c.clinicId + role] = (
        await db.query(
          "INSERT INTO staff_users(clinic_id,email,name,role,password_hash) VALUES($1,$2,$3,$3,'unused') RETURNING id",
          [c.clinicId, role + c.slug + '@test.invalid', role],
        )
      ).rows[0].id;
  app = await buildApp({
    pool,
    bus: new EventBus(''),
    gate: new LlmGate(null),
    jwtSecret: 'outbound-test',
    callingBridge: {
      [agent]: { clinicId: clinic.clinicId, appId: randomUUID(), secret: 'testsecret'.repeat(5) },
    },
    whatsappPlatform: {
      baseUrl: 'https://platform.example',
      clinics: { [clinic.clinicId]: { key: 'testprivatekey', externalUserId: 'owner' } },
      fetchImpl: async (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith('/readiness'))
          return Response.json({
            ready: true,
            enabled: true,
            ...(supported
              ? {
                  outbound: {
                    contract_version: 1,
                    supported: true,
                    enabled: true,
                    allowed_test_numbers: [number],
                  },
                }
              : {}),
          });
        if (init?.method === 'POST') {
          posts++;
          const b = JSON.parse(String(init.body));
          const r = { request_id: b.request_id, call_id: callId, status: 'accepted' };
          requests.set(b.request_id, r);
          if (fail) throw Error('timeout');
          return Response.json(r);
        }
        const id = path.split('/').at(-1)!;
        return Response.json(requests.get(id) ?? {}, { status: requests.has(id) ? 200 : 404 });
      },
    },
  });
});
afterAll(async () => {
  await app.close();
  await dropTestClinic(db, clinic.clinicId);
  await dropTestClinic(db, other.clinicId);
  await pool.end();
  await db.end();
});
it('never treats incoming readiness as outbound support and requires an approved test number', async () => {
  const r = await app.inject({ url: '/staff/agents/calling/outbound', headers: auth() });
  expect(r.json()).toMatchObject({ ready: false, supported: false });
  expect((await dial(make())).statusCode).toBe(409);
  expect(posts).toBe(0);
  supported = true;
  expect((await dial(make(randomUUID(), '+919800002222'))).statusCode).toBe(409);
  expect(posts).toBe(0);
});
it('requires admin role, clinic binding, ownership confirmation and charge acknowledgement', async () => {
  expect((await dial(make(), 'doctor')).statusCode).toBe(403);
  expect((await dial(make(), 'receptionist')).statusCode).toBe(403);
  expect((await dial(make(), 'admin', other)).statusCode).toBe(409);
  expect((await dial({ ...make(), acceptsCharges: false })).statusCode).toBe(400);
  expect((await dial({ ...make(), ownsNumber: false })).statusCode).toBe(400);
  expect(posts).toBe(0);
});
it('sends once under concurrent retries and refuses another pending call', async () => {
  const body = make();
  const rs = await Promise.all([dial(body), dial(body)]);
  for (const r of rs) expect(r.statusCode, r.body).toBe(200);
  expect(posts).toBe(1);
  expect((await dial(body)).statusCode).toBe(200);
  expect(posts).toBe(1);
  expect((await dial(make())).statusCode).toBe(409);
  const history = (
    await app.inject({ url: '/staff/agents/calling/outbound', headers: auth() })
  ).json();
  expect(history.calls[0]).toMatchObject({ last_four: '1111', status: 'accepted' });
  expect(JSON.stringify(history.calls)).not.toContain(number);
  requests.set(body.requestId, {
    request_id: body.requestId,
    call_id: callId,
    status: 'completed',
  });
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/staff/agents/calling/outbound/${body.requestId}/refresh`,
        headers: auth(),
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
});
it('persists an uncertain call, does not redial, and recovers by the request reference', async () => {
  fail = true;
  const body = make();
  const count = posts;
  expect((await dial(body)).json().status).toBe('unknown');
  fail = false;
  expect((await dial(body)).json().status).toBe('unknown');
  expect(posts).toBe(count + 1);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/staff/agents/calling/outbound/${body.requestId}/refresh`,
        headers: auth('admin', other),
        payload: {},
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/staff/agents/calling/outbound/${body.requestId}/refresh`,
        headers: auth(),
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
  expect((await dial(body)).json().status).toBe('accepted');
  expect(posts).toBe(count + 1);
});
