import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createTestClinic, dropTestClinic, makePool } from '@sahayak/db';
import { EventBus } from '@sahayak/core';
import { LlmGate } from '@sahayak/agents';
import { buildApp } from '../src/app';
const admin = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL }),
  pool = makePool();
let clinic: Awaited<ReturnType<typeof createTestClinic>>,
  other: typeof clinic,
  app: Awaited<ReturnType<typeof buildApp>>;
const agent = randomUUID(),
  appId = randomUUID(),
  seen: { path: string; method: string; body: unknown }[] = [];
let fail = false;
const staffIds: Record<string, string> = {};
beforeAll(async () => {
  await admin.connect();
  clinic = await createTestClinic(admin, 'callctl');
  other = await createTestClinic(admin, 'callctlother');
  for (const c of [clinic, other])
    for (const role of ['admin', 'doctor', 'receptionist']) {
      staffIds[c.clinicId + role] = (
        await admin.query(
          "INSERT INTO staff_users(clinic_id,email,password_hash,name,role) VALUES($1,$2,'unused',$3,$3) RETURNING id",
          [c.clinicId, `${role}-${c.slug}@test.invalid`, role],
        )
      ).rows[0].id;
    }
  app = await buildApp({
    pool,
    bus: new EventBus(''),
    gate: new LlmGate(null),
    jwtSecret: 'test',
    callingBridge: {
      [agent]: { clinicId: clinic.clinicId, appId, secret: 'testsecret'.repeat(5) },
    },
    whatsappPlatform: {
      baseUrl: 'https://platform.example',
      clinics: { [clinic.clinicId]: { key: 'private-key', externalUserId: 'operator' } },
      fetchImpl: async (input, init) => {
        if (fail) throw Error('unavailable');
        const path = new URL(String(input)).pathname;
        seen.push({
          path,
          method: init?.method ?? 'GET',
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        if (path.endsWith('/readiness'))
          return new Response(
            JSON.stringify({
              ready: false,
              code: 'configuration',
              message: 'Connect a voice number.',
              enabled: false,
              live_call_verified: false,
            }),
          );
        if (path.endsWith('/calls'))
          return new Response(JSON.stringify({ calls: [], next_before: null }));
        return new Response(
          JSON.stringify({
            enabled: JSON.parse(String(init?.body)).enabled,
            live_call_verified: false,
          }),
        );
      },
    },
  });
});
afterAll(async () => {
  await app.close();
  await dropTestClinic(admin, clinic.clinicId);
  await dropTestClinic(admin, other.clinicId);
  await admin.end();
  await pool.end();
});
const headers = (role = 'admin', clinicId = clinic.clinicId) => ({
  authorization:
    'Bearer ' + app.jwt.sign({ uid: staffIds[clinicId + role], clinicId, role, name: 'Test' }),
});
it('scopes readiness and history to the signed-in clinic agent', async () => {
  expect((await app.inject({ url: '/staff/agents/calling/readiness' })).statusCode).toBe(401);
  const r = await app.inject({ url: '/staff/agents/calling/readiness', headers: headers() });
  expect(r.statusCode).toBe(200);
  expect(r.json().code).toBe('configuration');
  expect(r.body).not.toContain('private-key');
  expect(seen.at(-1)?.path).toBe('/v1/calling/agents/' + agent + '/readiness');
  expect(
    (await app.inject({ url: '/staff/agents/calling/calls', headers: headers() })).json(),
  ).toEqual({ calls: [], next_before: null });
  const count = seen.length;
  expect(
    (
      await app.inject({
        url: '/staff/agents/calling/calls',
        headers: headers('admin', other.clinicId),
      })
    ).statusCode,
  ).toBe(409);
  expect(seen).toHaveLength(count);
  expect(
    (await app.inject({ url: '/staff/agents/calling/calls?before=wrong', headers: headers() }))
      .statusCode,
  ).toBe(400);
});
it('only the admin can change activation and errors never get retried', async () => {
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/staff/agents/calling/activation',
        headers: headers('receptionist'),
        payload: { enabled: true },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/staff/agents/calling/activation',
        headers: headers(),
        payload: { enabled: false },
      })
    ).json().enabled,
  ).toBe(false);
  expect(seen.at(-1)?.body).toEqual({ enabled: false });
  fail = true;
  expect(
    (await app.inject({ url: '/staff/agents/calling/readiness', headers: headers() })).statusCode,
  ).toBe(503);
  fail = false;
});
