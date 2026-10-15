import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID, createHmac } from 'node:crypto';
import pg from 'pg';
import { createTestClinic, dropTestClinic, makePool, withClinic, addPatient } from '@sahayak/db';
import { migrate } from '../../../packages/db/src/migrate';
import { EventBus } from '@sahayak/core';
import { LlmGate } from '@sahayak/agents';
import { buildApp } from '../src/app';
const admin = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL }),
  pool = makePool();
const agent = randomUUID(),
  appId = randomUUID(),
  secret = 'calling-test-secret-'.repeat(3);
let clinic: Awaited<ReturnType<typeof createTestClinic>>,
  other: typeof clinic,
  app: Awaited<ReturnType<typeof buildApp>>;
const body = (callId = randomUUID(), turn = 1, input = 'Hi', caller = '+919533330041') => ({
  probe: false,
  event_id: randomUUID(),
  agent_id: agent,
  app_id: appId,
  call_id: callId,
  caller,
  input,
  input_trust: 'untrusted_caller_data',
  turn,
  language: 'en-IN',
});
function signed(data: unknown, timestamp = String(Math.floor(Date.now() / 1000))) {
  const raw = JSON.stringify(data);
  return {
    payload: raw,
    headers: {
      'content-type': 'application/json',
      'x-agent-timestamp': timestamp,
      'x-agent-signature': createHmac('sha256', secret)
        .update(timestamp + '.' + raw)
        .digest('hex'),
    },
  };
}
const post = (data: unknown) =>
  app.inject({ method: 'POST', url: '/integrations/agent-platform/calling', ...signed(data) });
beforeAll(async () => {
  await migrate();
  await admin.connect();
  clinic = await createTestClinic(admin, 'voice');
  other = await createTestClinic(admin, 'voiceother');
  app = await buildApp({
    pool,
    bus: new EventBus(''),
    gate: new LlmGate(null),
    jwtSecret: 'test',
    callingBridge: { [agent]: { appId, clinicId: clinic.clinicId, secret } },
  });
});
afterAll(async () => {
  await app.close();
  await dropTestClinic(admin, clinic.clinicId);
  await dropTestClinic(admin, other.clinicId);
  await admin.end();
  await pool.end();
});
it('probes without patient writes and rejects altered identity, signatures and stale timestamps', async () => {
  const p = { probe: true, event_id: randomUUID(), agent_id: agent, app_id: appId };
  expect((await post(p)).json()).toEqual({ ready: true, event_id: p.event_id });
  expect((await post({ ...p, app_id: randomUUID() })).statusCode).toBe(403);
  expect((await post({ ...p, agent_id: randomUUID() })).statusCode).toBe(403);
  const bad = signed(p);
  bad.payload = JSON.stringify({ ...p, event_id: randomUUID() });
  expect(
    (await app.inject({ method: 'POST', url: '/integrations/agent-platform/calling', ...bad }))
      .statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/integrations/agent-platform/calling',
        ...signed(p, '1000000000'),
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (await admin.query('SELECT 1 FROM conversations WHERE clinic_id=$1', [clinic.clinicId]))
      .rowCount,
  ).toBe(0);
});
it('books only after consent and final YES, caches duplicate delivery and does not send WhatsApp', async () => {
  const id = randomUUID();
  let last: any, result: any;
  for (const [index, text] of [
    'Hi',
    '1',
    '1',
    'Voice Patient',
    'yes',
    '1',
    'earliest',
    '1',
    'yes',
  ].entries()) {
    last = body(id, index + 1, text);
    result = await post(last);
    expect(result.statusCode, result.body).toBe(200);
    if (index === 7) {
      expect(result.json().text).toContain('Confirm your appointment');
      expect(
        (await admin.query('SELECT 1 FROM appointments WHERE clinic_id=$1', [clinic.clinicId]))
          .rowCount,
      ).toBe(0);
    }
  }
  expect(result.json().action).toBe('end');
  expect(result.json().text).toContain('is booked for');
  expect((await post(last)).json()).toEqual(result.json());
  expect((await post({ ...last, input: 'no' })).statusCode).toBe(409);
  expect((await post(body(id, 10, 'yes'))).statusCode).toBe(409);
  expect(
    (await admin.query('SELECT source FROM appointments WHERE clinic_id=$1', [clinic.clinicId]))
      .rows,
  ).toEqual([{ source: 'agent' }]);
  expect(
    (await admin.query('SELECT 1 FROM outbox WHERE clinic_id=$1', [clinic.clinicId])).rowCount,
  ).toBe(0);
  expect(
    (await withClinic(pool, other.clinicId, (db) => db.query('SELECT 1 FROM calling_sessions')))
      .rowCount,
  ).toBe(0);
});
it('does not resolve previous patient records by caller ID and ends private-data requests', async () => {
  await addPatient(admin, clinic.clinicId, 'Secret Existing Patient', '+919533330042');
  const id = randomUUID(),
    first = await post(body(id, 1, 'Hi', '+919533330042'));
  expect(first.statusCode).toBe(200);
  expect(first.body).not.toContain('Secret Existing Patient');
  expect(
    (
      await admin.query('SELECT patient_id FROM conversations WHERE clinic_id=$1 AND contact=$2', [
        clinic.clinicId,
        'voice:' + agent + ':' + id,
      ])
    ).rows[0].patient_id,
  ).toBeNull();
  const second = await post(body(id, 2, 'my records', '+919533330042'));
  expect(second.json().action).toBe('handoff');
  expect(second.body).not.toContain('Secret Existing Patient');
});
it('rejects skipped turns, changed caller and new events while a turn needs reconciliation', async () => {
  const id = randomUUID();
  expect((await post(body(id, 2))).statusCode).toBe(409);
  const first = body(id);
  expect((await post(first)).statusCode).toBe(200);
  expect((await post(body(id, 2, '1', '+919533330043'))).statusCode).toBe(409);
  await admin.query('UPDATE calling_sessions SET in_flight=true WHERE call_id=$1', [id]);
  expect((await post(body(id, 2, '1'))).statusCode).toBe(409);
  await admin.query(
    "UPDATE agent_platform_receipts SET state='UNKNOWN',response=NULL WHERE event_id=$1",
    [first.event_id],
  );
  expect((await post(first)).statusCode).toBe(409);
});
it('raises an urgent flag and speaks emergency guidance without booking', async () => {
  const r = await post(body(randomUUID(), 1, 'I have severe chest pain'));
  expect(r.statusCode).toBe(200);
  expect(r.json().action).toBe('handoff');
  expect(r.json().text).toContain('108');
  expect(
    (
      await admin.query("SELECT 1 FROM flags WHERE clinic_id=$1 AND kind='red_flag'", [
        clinic.clinicId,
      ])
    ).rowCount,
  ).toBe(1);
});

it.skipIf(!process.env.AI_AGENT_PLATFORM_DIR)(
  'accepts the deployed Python calling contract over HTTP',
  async () => {
    const url = await app.listen({ port: 0, host: '127.0.0.1' });
    const payload = body(randomUUID(), 1, 'Hi');
    const code = `import asyncio,json,os
from agent_platform.calling import invoke
async def main():
 cfg=json.loads(os.environ['VOICE_TEST_CONFIG'])
 p=json.loads(os.environ['VOICE_TEST_PAYLOAD'])
 result=await invoke(cfg,p)
 print(json.dumps(result))
asyncio.run(main())`;
    const result = await promisify(execFile)(
      process.env.AI_AGENT_PLATFORM_DIR + '/.venv/bin/python',
      ['-c', code],
      {
        env: {
          ...process.env,
          PYTHONPATH: process.env.AI_AGENT_PLATFORM_DIR + '/src',
          VOICE_TEST_CONFIG: JSON.stringify({
            handler_url: url + '/integrations/agent-platform/calling',
            handler_secret: secret,
          }),
          VOICE_TEST_PAYLOAD: JSON.stringify(payload),
        },
        timeout: 10000,
      },
    );
    expect(JSON.parse(result.stdout)).toMatchObject({
      event_id: payload.event_id,
      action: 'continue',
    });
  },
);

it.skipIf(!process.env.AI_AGENT_PLATFORM_DIR)(
  'books through the real internet voice client with an app caller identity',
  async () => {
    const address=app.server.address() as {port:number};
    const session=randomUUID(), caller=randomUUID();
    const before=Number((await admin.query('SELECT count(*) n FROM appointments WHERE clinic_id=$1',[clinic.clinicId])).rows[0].n);
    const code=`import asyncio,json,os
from uuid import uuid4
from agent_platform.web_voice import invoke
async def main():
 cfg=json.loads(os.environ['VOICE_TEST_CONFIG'])
 base=json.loads(os.environ['VOICE_TEST_PAYLOAD'])
 replies=[]
 for turn,text in enumerate(['Hi','1','1','Web Voice Patient','yes','1','earliest','1','yes'],1):
  reply=await invoke(cfg,{**base,'event_id':str(uuid4()),'turn':turn,'input':text})
  replies.append(reply)
 print(json.dumps(replies))
asyncio.run(main())`;
    const result=await promisify(execFile)(process.env.AI_AGENT_PLATFORM_DIR+'/.venv-voice/bin/python',['-c',code],{
      env:{...process.env,PYTHONPATH:process.env.AI_AGENT_PLATFORM_DIR+'/src',
        VOICE_TEST_CONFIG:JSON.stringify({url:`http://127.0.0.1:${address.port}/integrations/agent-platform/voice`,secret}),
        VOICE_TEST_PAYLOAD:JSON.stringify({caller_phone:'+919533330049',session_id:session,agent_id:agent,app_id:appId,user_id:caller,input_trust:'untrusted_speech',channel:'web_voice',language:'en',conversation:[]})},timeout:15000});
    const replies=JSON.parse(result.stdout);
    expect(replies[7].text).toContain('Confirm your appointment');
    expect(replies[8].text).toContain('is booked for');
    expect(replies[8].action).toBe('end');
    expect(Number((await admin.query('SELECT count(*) n FROM appointments WHERE clinic_id=$1',[clinic.clinicId])).rows[0].n)).toBe(before+1);
    expect((await admin.query('SELECT 1 FROM outbox WHERE clinic_id=$1',[clinic.clinicId])).rowCount).toBe(0);
  },
);
