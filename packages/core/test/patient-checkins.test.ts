import { beforeAll, afterAll, it, expect } from 'vitest';
import pg from 'pg';
import { addPatient, createTestClinic, dropTestClinic, makePool } from '@sahayak/db';
import { callTool, EventBus, registerAllTools, type ToolContext } from '../src';
const admin = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
const pool = makePool();
const rt = {
  pool,
  bus: new EventBus(''),
  channel: { name: 'test-provider', queued: true, send: async () => {} },
};
let a: Awaited<ReturnType<typeof createTestClinic>>, b: typeof a;
let ctx: ToolContext,
  patient: string,
  visit: string,
  owner: string,
  other: string,
  noConsent: string;
const run = (name: string, input: unknown) => callTool(rt, ctx, name, input);
const input = () => ({
  patientId: patient,
  queueEntryId: visit,
  assignedTo: owner,
  scheduledAt: new Date(Date.now() + 86400000).toISOString(),
  language: 'hi',
  consent: true,
});
beforeAll(async () => {
  await admin.connect();
  registerAllTools();
  a = await createTestClinic(admin, 'checkins');
  b = await createTestClinic(admin, 'other-checkins');
  owner = (
    await admin.query(
      "INSERT INTO staff_users(clinic_id,email,password_hash,name,role,doctor_id) VALUES ($1,$2,'unused','Check-in doctor','doctor',$3) RETURNING id",
      [a.clinicId, `${a.slug}@test.invalid`, a.doctorIds[0]],
    )
  ).rows[0].id;
  ctx = {
    clinicId: a.clinicId,
    actor: { kind: 'staff', role: 'doctor', userId: owner, doctorId: a.doctorIds[0] },
  };
  patient = await addPatient(admin, a.clinicId, 'Check-in test', '+919400022221');
  other = await addPatient(admin, b.clinicId, 'Other clinic', '+919400022222');
  noConsent = await addPatient(admin, a.clinicId, 'No permission', '+919400022223', {
    whatsapp: false,
  });
  visit = (
    await admin.query(
      "INSERT INTO queue_entries(clinic_id,patient_id,doctor_id,queue_date,token_number,position_key,status) VALUES ($1,$2,$3,current_date,9010,9010,'in_consultation') RETURNING id",
      [a.clinicId, patient, a.doctorIds[0]],
    )
  ).rows[0].id;
});
afterAll(async () => {
  await dropTestClinic(admin, a.clinicId);
  await dropTestClinic(admin, b.clinicId);
  await pool.end();
  await admin.end();
});
it('requires explicit agreement, permissions, a future time and matching clinic/visit/owner', async () => {
  await expect(run('schedule_patient_checkin', { ...input(), consent: false })).rejects.toThrow();
  await expect(
    run('schedule_patient_checkin', { ...input(), scheduledAt: new Date(0).toISOString() }),
  ).rejects.toThrow('future');
  await expect(run('schedule_patient_checkin', { ...input(), patientId: other })).rejects.toThrow(
    'Patient not found',
  );
  await expect(
    run('schedule_patient_checkin', { ...input(), patientId: noConsent }),
  ).rejects.toThrow('permission');
  await expect(run('schedule_patient_checkin', { ...input(), assignedTo: other })).rejects.toThrow(
    'staff member',
  );
  await expect(
    run('schedule_patient_checkin', { ...input(), queueEntryId: other }),
  ).rejects.toThrow('visit');
});
it('prevents duplicate schedules, lists owners, cancels and handles STOP', async () => {
  const results = await Promise.allSettled([
    run('schedule_patient_checkin', input()),
    run('schedule_patient_checkin', input()),
  ]);
  expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((x) => x.status === 'rejected')).toHaveLength(1);
  const list = await run('list_patient_checkins', { patientId: patient });
  expect(list.checkins).toHaveLength(1);
  expect(list.checkins[0].assignee).toBe('Check-in doctor');
  expect((await run('list_patient_checkins', { patientId: other })).checkins).toHaveLength(0);
  await run('cancel_patient_checkin', { id: list.checkins[0].id });
  await run('schedule_patient_checkin', input());
  await run('withdraw_messaging', { patientId: patient });
  const after = await run('list_patient_checkins', { patientId: patient });
  expect(after.checkins.every((c: any) => c.status === 'cancelled')).toBe(true);
  expect(after.checkins.some((c: any) => c.cancellation_reason === 'consent_withdrawn')).toBe(true);
  await expect(run('schedule_patient_checkin', input())).rejects.toThrow('permission');
});
