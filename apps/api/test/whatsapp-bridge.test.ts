import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID, createHmac, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
import { createTestClinic, dropTestClinic, makePool, withClinic } from '@sahayak/db';
import { migrate } from '../../../packages/db/src/migrate';
import { EventBus } from '@sahayak/core';
import { LlmGate } from '@sahayak/agents';
import { buildApp } from '../src/app';
const admin = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL }),
  pool = makePool();
const channel = randomUUID(),
  appId = randomUUID(),
  secret = 'fixture-bridge-secret-'.repeat(3);
let clinic: Awaited<ReturnType<typeof createTestClinic>>,
  other: typeof clinic,
  app: Awaited<ReturnType<typeof buildApp>>,
  url: string;
const payload = (text = 'Hi') => ({
  event_id: randomUUID(),
  channel_id: channel,
  app_id: appId,
  clinic_id: clinic.clinicId,
  from: '919533330001',
  text,
});
function signed(body: unknown, stamp = String(Math.floor(Date.now() / 1000))) {
  const raw = JSON.stringify(body);
  return {
    payload: raw,
    headers: {
      'content-type': 'application/json',
      'x-agent-timestamp': stamp,
      'x-agent-signature': createHmac('sha256', secret)
        .update(stamp + '.' + raw)
        .digest('hex'),
    },
  };
}
const post = (body: unknown) =>
  app.inject({ method: 'POST', url: '/integrations/agent-platform/whatsapp', ...signed(body) });
beforeAll(async () => {
  await migrate();
  await admin.connect();
  clinic = await createTestClinic(admin, 'bridge');
  other = await createTestClinic(admin, 'bridgeother');
  app = await buildApp({
    pool,
    bus: new EventBus(''),
    gate: new LlmGate(null),
    jwtSecret: 'test',
    whatsappBridge: { [channel]: { appId, clinicId: clinic.clinicId, secret } },
  });
  url = await app.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(async () => {
  await app.close();
  await dropTestClinic(admin, clinic.clinicId);
  await dropTestClinic(admin, other.clinicId);
  await admin.end();
  await pool.end();
});
it('authenticates exact clinic/channel/app and rejects tampered and stale requests', async () => {
  const b = payload();
  expect((await post({ ...b, clinic_id: other.clinicId })).statusCode).toBe(403);
  expect((await post({ ...b, app_id: randomUUID() })).statusCode).toBe(403);
  const bad = signed(b);
  bad.payload = JSON.stringify({ ...b, text: 'changed' });
  expect(
    (await app.inject({ method: 'POST', url: '/integrations/agent-platform/whatsapp', ...bad }))
      .statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/integrations/agent-platform/whatsapp',
        ...signed(b, '1000000000'),
      })
    ).statusCode,
  ).toBe(403);
});
it('returns cached replies without adding messages; rejects conflicting event content and unfinished receipts', async () => {
  const b = payload();
  const first = await post(b);
  expect(first.statusCode).toBe(200);
  expect(first.json().replies[0]).toContain('Book an appointment');
  expect((await post(b)).json()).toEqual(first.json());
  expect((await post({ ...b, text: '1' })).statusCode).toBe(409);
  const pending = payload('pending');
  await withClinic(pool, clinic.clinicId, (db) =>
    db.query(
      "INSERT INTO agent_platform_receipts(clinic_id,channel_id,event_id,digest,state) VALUES($1,$2,$3,$4,'PROCESSING')",
      [
        clinic.clinicId,
        channel,
        pending.event_id,
        createHash('sha256').update(JSON.stringify(pending)).digest('hex'),
      ],
    ),
  );
  expect((await post(pending)).statusCode).toBe(409);
  expect(
    (
      await withClinic(pool, other.clinicId, (db) =>
        db.query('SELECT * FROM agent_platform_receipts'),
      )
    ).rowCount,
  ).toBe(0);
});
it.skipIf(!process.env.AI_AGENT_PLATFORM_DIR)(
  'accepts the actual Python platform client over HTTP and books once on final YES',
  async () => {
    const platform = process.env.AI_AGENT_PLATFORM_DIR!;
    const code = `import asyncio,json,os
from uuid import uuid4
from agent_platform.sahayak_bridge import request
async def main():
 c=json.loads(os.environ['BRIDGE_TEST_CHANNEL'])
 out=[]
 for text in ['Hi','1','1','Bridge Patient','yes','1','earliest','1','yes']:
  event=uuid4()
  out.append(await request(c,event,'919533330002',text))
 out.append(await request(c,event,'919533330002','yes'))
 print(json.dumps(out))
asyncio.run(main())`;
    const result = await promisify(execFile)(platform + '/.venv/bin/python', ['-c', code], {
      env: {
        ...process.env,
        PYTHONPATH: platform + '/src',
        BRIDGE_TEST_CHANNEL: JSON.stringify({ id: channel, app_id: appId }),
        AI_SAHAYAK_BRIDGES: JSON.stringify({
          [channel]: {
            app_id: appId,
            clinic_id: clinic.clinicId,
            url: url + '/integrations/agent-platform/whatsapp',
            secret,
          },
        }),
      },
      timeout: 20000,
    });
    const turns = JSON.parse(result.stdout);
    expect(turns[7].replies[0]).toContain('Confirm your appointment');
    expect(turns[8].replies[0]).toContain('is booked for');
    expect(turns[9]).toEqual(turns[8]);
    const rows = await admin.query(
      "SELECT a.id FROM appointments a JOIN patients p ON p.id=a.patient_id WHERE a.clinic_id=$1 AND p.phone='+919533330002'",
      [clinic.clinicId],
    );
    expect(rows.rowCount).toBe(1);
    const outbox = await admin.query(
      "SELECT 1 FROM outbox WHERE clinic_id=$1 AND to_contact='+919533330002'",
      [clinic.clinicId],
    );
    expect(outbox.rowCount).toBe(0);
  },
);
it('probes readiness without starting conversations', async () => {
  expect((await post({ ...payload(), probe: true })).json()).toEqual({
    ready: true,
    clinic_id: clinic.clinicId,
  });
});
it('accepts current option taps, rejects old taps, and retains typed replies', async () => {
  const send = (text: string) => post({ ...payload(text), from: '919533330009' });
  const menu = (await send('Hi')).json();
  expect(menu.options.choices).toHaveLength(4);
  const book = menu.options.choices[0].id;
  const visit = (await send(book)).json();
  expect(visit.replies[0]).toContain('first visit');
  const stale = (await send(book)).json();
  expect(stale.replies[0]).toContain('earlier step');
  expect(stale.options.choices).toEqual(visit.options.choices);
  const next = (await send(visit.options.choices[0].id)).json();
  expect(next.options).toBeUndefined();
  expect(next.replies[0]).toContain('name');
  const consent = (await send('Choice Patient')).json();
  expect(consent.options.choices.map((x: any) => x.title)).toEqual(['Yes', 'No']);
});
