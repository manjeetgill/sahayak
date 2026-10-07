import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import pg from 'pg';
import { createTestClinic, dropTestClinic, makePool, withClinic } from '@sahayak/db';
import { migrate } from '../../../packages/db/src/migrate';
import { EventBus } from '@sahayak/core';
import { LlmGate } from '@sahayak/agents';
import { buildApp } from '../src/app';
import { whatsappPlatform, whatsappPlatformFromEnv } from '../src/whatsapp-platform';
import { z } from 'zod';
const admin = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL }),
  pool = makePool();
let a: Awaited<ReturnType<typeof createTestClinic>>,
  b: typeof a,
  app: Awaited<ReturnType<typeof buildApp>>;
const session = '11111111-1111-4111-8111-111111111111';
const remote = vi.fn(
  async (url: any) =>
    new Response(
      JSON.stringify(
        String(url).endsWith('/config')
          ? { available: true }
          : String(url).endsWith('/complete')
            ? { state: 'OWNERSHIP_CHECK_REQUIRED' }
            : { id: session, connect_token: 'x'.repeat(30) },
      ),
      { status: 200 },
    ),
);
const h = (clinicId: string, role = 'admin') => ({
  authorization:
    'Bearer ' +
    app.jwt.sign({ uid: staffIds[clinicId + role], clinicId, role, doctorId: null, name: 'Test' }),
});
const staffIds: Record<string, string> = {};
beforeAll(async () => {
  await migrate();
  await admin.connect();
  a = await createTestClinic(admin, 'was');
  b = await createTestClinic(admin, 'wab');
  for (const c of [a, b])
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
    whatsappProvisioning: {
      url: 'https://sahayak.example/integrations/agent-platform/whatsapp',
      secret: 'test-root-secret-'.repeat(4),
    },
    whatsappPlatform: {
      baseUrl: 'https://platform.example',
      clinics: { [a.clinicId]: { key: 'private-key', externalUserId: 'business-owner' } },
      fetchImpl: remote as typeof fetch,
    },
  });
});
afterAll(async () => {
  if (a) await dropTestClinic(admin, a.clinicId);
  if (b) await dropTestClinic(admin, b.clinicId);
  await app?.close();
  await pool.end();
  await admin.end();
});
it('restricts setup editing to admins and isolates clinic details', async () => {
  const payload = { phone: '+919876543210', faq: 'Open weekdays' };
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: '/staff/agents/whatsapp/setup',
        headers: h(a.clinicId, 'receptionist'),
        payload,
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: '/staff/agents/whatsapp/setup',
        headers: h(a.clinicId),
        payload,
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await app.inject({
        method: 'GET',
        url: '/staff/agents/whatsapp/setup',
        headers: h(b.clinicId),
      })
    ).json().setup,
  ).toBeNull();
  const rows = await withClinic(pool, b.clinicId, (db) =>
    db.query('SELECT * FROM clinic_whatsapp_setup'),
  );
  expect(rows.rowCount).toBe(0);
});
it('starts once, binds completion to the stored session, and leaves live replies paused', async () => {
  const start = await app.inject({
    method: 'POST',
    url: '/staff/agents/whatsapp/connect',
    headers: h(a.clinicId),
    payload: {},
  });
  expect(start.statusCode).toBe(200);
  expect(start.headers['cache-control']).toBe('no-store');
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/staff/agents/whatsapp/connect',
        headers: h(a.clinicId),
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
  expect(remote.mock.calls.filter((c) => String(c[0]).endsWith('/onboarding'))).toHaveLength(1);
  const completed = await app.inject({
    method: 'POST',
    url: '/staff/agents/whatsapp/complete',
    headers: h(a.clinicId),
    payload: { plugin_id: session, session_id: 'untrusted' },
  });
  expect(completed.statusCode).toBe(200);
  expect(completed.json().state).toBe('OWNERSHIP_CHECK_REQUIRED');
  const status = (
    await app.inject({ method: 'GET', url: '/staff/agents/whatsapp/setup', headers: h(a.clinicId) })
  ).json();
  expect(status.liveRepliesEnabled).toBe(false);
  expect(JSON.stringify(status)).not.toContain('private-key');
});
it('does not use another clinic credential or retry an uncertain request', async () => {
  const fetchImpl = vi.fn(async () => {
    throw new Error('private provider detail');
  });
  const options = {
    baseUrl: 'https://platform.example',
    clinics: { [a.clinicId]: { key: 'secret-secret', externalUserId: 'owner' } },
    fetchImpl: fetchImpl as typeof fetch,
  };
  await expect(whatsappPlatform(options, b.clinicId, '/config', z.unknown())).rejects.toThrow(
    'setup team',
  );
  expect(fetchImpl).not.toHaveBeenCalled();
  await expect(
    whatsappPlatform(options, a.clinicId, '/onboarding', z.unknown(), {}),
  ).rejects.toThrow('Agent service unavailable');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(
    whatsappPlatformFromEnv({
      AGENT_CHANNEL_PLATFORM_URL: 'http://public.example',
      AGENT_CHANNEL_CREDENTIALS: '{}',
    }),
  ).toBeUndefined();
});

it('finishes verified signup into a bound channel, then gates activation on webhook verification', async () => {
  let verified = false,
    enabled = false;
  const channel = '22222222-2222-4222-8222-222222222222',
    appId = '33333333-3333-4333-8333-333333333333';
  remote.mockImplementation(async (url: any, init?: any) => {
    const path = String(url);
    let data: unknown;
    if (path.endsWith('/channel'))
      data = {
        id: channel,
        app_id: appId,
        enabled,
        execution_mode: 'SAHAYAK',
        webhook_verified_at: verified ? new Date().toISOString() : null,
      };
    else if (path.includes('/v1/whatsapp/channels?'))
      data = [
        {
          id: channel,
          app_id: appId,
          enabled,
          execution_mode: 'SAHAYAK',
          webhook_verified_at: verified ? new Date().toISOString() : null,
        },
      ];
    else if (path.endsWith('/sahayak')) {
      const body = JSON.parse(init.body);
      expect(body.clinic_id).toBe(a.clinicId);
      expect(body.secret.length).toBe(64);
      data = { configured: true };
    } else if (path.endsWith('/webhook')) data = { configured: true, verified };
    else if (path.endsWith('/activation')) {
      enabled = JSON.parse(init.body).enabled;
      data = { enabled };
    } else data = { state: 'CONNECTED' };
    return new Response(JSON.stringify(data), { status: 200 });
  });
  const refresh = () =>
    app.inject({
      method: 'POST',
      url: '/staff/agents/whatsapp/refresh',
      headers: h(a.clinicId),
      payload: {},
    });
  expect((await refresh()).json().preparation).toBe('WEBHOOK_PENDING');
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/staff/agents/whatsapp/activation',
        headers: h(a.clinicId),
        payload: { enabled: true },
      })
    ).statusCode,
  ).toBe(409);
  verified = true;
  expect((await refresh()).json().preparation).toBe('READY');
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/staff/agents/whatsapp/activation',
        headers: h(a.clinicId, 'receptionist'),
        payload: { enabled: true },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/staff/agents/whatsapp/activation',
        headers: h(a.clinicId),
        payload: { enabled: true },
      })
    ).json().preparation,
  ).toBe('ACTIVE');
  expect(
    (
      await app.inject({
        method: 'GET',
        url: '/staff/agents/whatsapp/setup',
        headers: h(a.clinicId),
      })
    ).json().liveRepliesEnabled,
  ).toBe(true);
  expect((await refresh()).json().channel_id).toBe(channel);
});

it('reports an unavailable platform without claiming the saved active channel is live', async () => {
  remote.mockImplementation(async () => {
    throw new Error('offline');
  });
  const r = await app.inject({
    method: 'GET',
    url: '/staff/agents/whatsapp/setup',
    headers: h(a.clinicId),
  });
  expect(r.statusCode).toBe(200);
  expect(r.json().liveRepliesEnabled).toBe(false);
  expect(r.json().setup.preparation).toBe('UNAVAILABLE');
  const other = await app.inject({
    method: 'GET',
    url: '/staff/agents/whatsapp/setup',
    headers: h(b.clinicId),
  });
  expect(other.json().setup).toBeNull();
});
