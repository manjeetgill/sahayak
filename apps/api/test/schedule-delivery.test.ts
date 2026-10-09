import { afterAll, beforeAll, beforeEach, afterEach, it, expect } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { createTestClinic, dropTestClinic, makePool, addPatient } from '@sahayak/db';
import { callTool, registerAllTools, EventBus, type ToolContext } from '@sahayak/core';
import { LlmGate } from '@sahayak/agents';
import { dispatchScheduleNotice, refreshScheduleNotices } from '../src/schedule-delivery';
import type { AppDeps } from '../src/app';
const db = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL }),
  pool = makePool(),
  bus = new EventBus('');
let clinic: Awaited<ReturnType<typeof createTestClinic>>,
  patient: string,
  ctx: ToolContext,
  deps: AppDeps,
  delivery: string,
  provider: string,
  requests: string[],
  history: any[],
  approveFails: boolean;
beforeAll(async () => {
  await db.connect();
  registerAllTools();
});
afterAll(async () => {
  await pool.end();
  await db.end();
});
beforeEach(async () => {
  clinic = await createTestClinic(db, 'notice');
  patient = await addPatient(db, clinic.clinicId, 'Demo Notice', '+919000001234');
  ctx = {
    clinicId: clinic.clinicId,
    actor: {
      kind: 'staff',
      role: 'doctor',
      doctorId: clinic.doctorIds[0],
      userId: undefined as any,
    },
  };
  const channel = randomUUID();
  provider = randomUUID();
  requests = [];
  history = [];
  approveFails = false;
  deps = {
    pool,
    bus,
    gate: new LlmGate(null),
    jwtSecret: 'test-only',
    whatsappBridge: {
      [channel]: { clinicId: clinic.clinicId, appId: randomUUID(), secret: 'x'.repeat(32) },
    },
    whatsappPlatform: {
      baseUrl: 'https://test.invalid',
      clinics: { [clinic.clinicId]: { key: 'test-key-not-real', externalUserId: 'test' } },
      fetchImpl: (async (url: any) => {
        requests.push(String(url));
        if (String(url).endsWith('/approve') && approveFails) throw new Error('lost response');
        return new Response(
          JSON.stringify(
            String(url).endsWith('/session-outbound')
              ? { id: provider, status: 'DRAFT' }
              : String(url).endsWith('/approve')
                ? { id: provider, status: 'QUEUED' }
                : history,
          ),
          { status: 200 },
        );
      }) as typeof fetch,
    },
  };
  await db.query(
    "INSERT INTO appointments(clinic_id,doctor_id,patient_id,starts_at,ends_at,source) VALUES($1,$2,$3,now()+interval '5 minutes',now()+interval '15 minutes','whatsapp')",
    [clinic.clinicId, clinic.doctorIds[0], patient],
  );
  const rt = { pool, bus, requireLiveChannel: true, platformClinics: [clinic.clinicId] };
  const proposal = await callTool(rt, ctx, 'propose_schedule_shift', { minutes: 5 });
  const confirmed = await callTool(rt, ctx, 'confirm_schedule_shift', {
    proposalId: proposal.proposalId,
  });
  expect(confirmed.queued).toBe(1);
  expect(confirmed.notified).toBe(0);
  delivery = (
    await db.query('SELECT id FROM schedule_message_delivery WHERE clinic_id=$1', [clinic.clinicId])
  ).rows[0].id;
});
afterEach(async () => {
  await dropTestClinic(db, clinic.clinicId);
});
const row = async () =>
  (await db.query('SELECT * FROM schedule_message_delivery WHERE id=$1', [delivery])).rows[0];
it('queues confirmed notices once and counts notification only on delivery receipt', async () => {
  await dispatchScheduleNotice(deps, clinic.clinicId, delivery);
  await dispatchScheduleNotice(deps, clinic.clinicId, delivery);
  expect(requests).toHaveLength(2);
  expect((await row()).state).toBe('queued');
  const item = (await row()).item_id;
  expect(
    (await db.query('SELECT notified FROM schedule_shift_items WHERE id=$1', [item])).rows[0]
      .notified,
  ).toBe(false);
  history = [{ id: provider, status: 'ACCEPTED', delivery: 'delivered' }];
  await refreshScheduleNotices(deps, clinic.clinicId);
  expect(
    (await db.query('SELECT notified FROM schedule_shift_items WHERE id=$1', [item])).rows[0]
      .notified,
  ).toBe(true);
  history = [{ id: provider, status: 'ACCEPTED', delivery: 'sent' }];
  await refreshScheduleNotices(deps, clinic.clinicId);
  expect((await row()).state).toBe('delivered');
});
it('does not send after consent is withdrawn', async () => {
  await db.query(
    "UPDATE consents SET withdrawn_at=now() WHERE patient_id=$1 AND purpose='whatsapp_messaging'",
    [patient],
  );
  await dispatchScheduleNotice(deps, clinic.clinicId, delivery);
  expect(requests).toHaveLength(0);
  expect((await row()).state).toBe('cancelled');
});
it('does not overwrite a conversation needing staff help', async () => {
  await db.query(
    "INSERT INTO conversations(clinic_id,patient_id,channel,contact,handled_by,state) VALUES($1,$2,'whatsapp','+919000001234','human','{}')",
    [clinic.clinicId, patient],
  );
  await dispatchScheduleNotice(deps, clinic.clinicId, delivery);
  expect(requests).toHaveLength(0);
  expect((await row()).state).toBe('blocked');
});
it('does not retry after an uncertain approval response', async () => {
  approveFails = true;
  await dispatchScheduleNotice(deps, clinic.clinicId, delivery);
  await dispatchScheduleNotice(deps, clinic.clinicId, delivery);
  expect(requests).toHaveLength(2);
  expect((await row()).state).toBe('unknown');
});
