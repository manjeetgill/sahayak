import { beforeAll, afterAll, it, expect } from 'vitest';
import pg from 'pg';
import { createTestClinic, dropTestClinic, addPatient, makePool } from '@sahayak/db';
import { callTool, EventBus, registerAllTools, type ToolContext } from '../src';
const admin = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL }),
  pool = makePool(),
  rt = { pool, bus: new EventBus('') };
let clinic: Awaited<ReturnType<typeof createTestClinic>>,
  other: typeof clinic,
  doctor: string,
  reception: string,
  foreign: string,
  patient: string,
  noConsent: string,
  ctx: ToolContext;
let token = 9100;
const run = (name: string, input: unknown, context = ctx) => callTool(rt, context, name, input);
const policy = (extra = {}) => ({
  enabled: true,
  delayDays: 1,
  sendTime: '18:30',
  assignedTo: reception,
  reminder: true,
  ...extra,
});
async function visit(p = patient, d = clinic.doctorIds[0]) {
  return (
    await admin.query(
      "INSERT INTO queue_entries(clinic_id,patient_id,doctor_id,queue_date,token_number,position_key,status) VALUES($1,$2,$3,current_date,$4::int,$4::numeric,'in_consultation') RETURNING id",
      [clinic.clinicId, p, d, ++token],
    )
  ).rows[0].id as string;
}
const rows = (id: string) =>
  admin.query('SELECT * FROM patient_checkins WHERE queue_entry_id=$1', [id]);
beforeAll(async () => {
  await admin.connect();
  registerAllTools();
  clinic = await createTestClinic(admin, 'auto-feedback');
  other = await createTestClinic(admin, 'auto-other');
  await admin.query("UPDATE clinics SET timezone='Asia/Kolkata' WHERE id=$1", [clinic.clinicId]);
  for (const [c, role] of [
    [clinic, 'doctor'],
    [clinic, 'receptionist'],
    [other, 'receptionist'],
  ] as const) {
    const id = (
      await admin.query(
        "INSERT INTO staff_users(clinic_id,email,name,role,password_hash,doctor_id) VALUES($1,$2,$3,$3,'unused',$4) RETURNING id",
        [
          c.clinicId,
          `${role}-${c.slug}@test.invalid`,
          role,
          role === 'doctor' ? c.doctorIds[0] : null,
        ],
      )
    ).rows[0].id;
    if (c === other) foreign = id;
    else if (role === 'doctor') doctor = id;
    else reception = id;
  }
  ctx = {
    clinicId: clinic.clinicId,
    actor: { kind: 'staff', role: 'doctor', userId: doctor, doctorId: clinic.doctorIds[0] },
  };
  patient = await addPatient(
    admin,
    clinic.clinicId,
    'Automatic feedback patient',
    '+919422221111',
    { lang: 'hi' },
  );
  noConsent = await addPatient(admin, clinic.clinicId, 'No consent', '+919422221112', {
    whatsapp: false,
  });
});
afterAll(async () => {
  await dropTestClinic(admin, clinic.clinicId);
  await dropTestClinic(admin, other.clinicId);
  await pool.end();
  await admin.end();
});
it('starts off, saves doctor preferences and prevents another role or clinic owner assignment', async () => {
  expect((await run('get_feedback_preferences', {})).enabled).toBe(false);
  await expect(run('save_feedback_preferences', policy({ assignedTo: foreign }))).rejects.toThrow(
    'this clinic',
  );
  await expect(
    run('save_feedback_preferences', policy(), {
      clinicId: clinic.clinicId,
      actor: { kind: 'staff', role: 'receptionist', userId: reception },
    }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(run('save_feedback_preferences', policy({ sendTime: '23:00' }))).rejects.toThrow();
  await run('save_feedback_preferences', policy());
  expect(await run('get_feedback_preferences', {})).toMatchObject({
    enabled: true,
    sendTime: '18:30',
    assignedTo: reception,
    timezone: 'Asia/Kolkata',
    deliveryEnabled: false,
  });
});
it('finishing schedules once with clinic-local timing, existing consent, language and responsible staff even when delivery is paused', async () => {
  const id = await visit();
  const preview = await run('get_visit_checklist', { queueEntryId: id });
  expect(preview.feedbackPlan.state).toBe('ready');
  const result = await run('finish_visit', { queueEntryId: id });
  expect(result.feedback.state).toBe('scheduled');
  const stored = (await rows(id)).rows[0];
  expect(stored).toMatchObject({
    assigned_to: reception,
    language: 'hi',
    reminder_enabled: true,
    consent_notice: 'automatic-post-visit-existing-followup-consent-v1',
  });
  const timing = (
    await admin.query(
      "SELECT to_char(c.scheduled_at AT TIME ZONE 'Asia/Kolkata','HH24:MI') time,(c.scheduled_at AT TIME ZONE 'Asia/Kolkata')::date=(q.finished_at AT TIME ZONE 'Asia/Kolkata')::date+1 next_day FROM patient_checkins c JOIN queue_entries q ON q.id=c.queue_entry_id WHERE q.id=$1",
      [id],
    )
  ).rows[0];
  expect(timing).toEqual({ time: '18:30', next_day: true });
  expect(stored.consented_at.getTime()).toBeLessThanOrEqual(stored.created_at.getTime());
  await expect(run('finish_visit', { queueEntryId: id })).rejects.toThrow('active visit');
  expect((await rows(id)).rowCount).toBe(1);
  expect(
    (await admin.query('SELECT 1 FROM patient_feedback_delivery WHERE checkin_id=$1', [stored.id]))
      .rowCount,
  ).toBe(0);
});
it('does not schedule without patient permissions, but still finishes the visit', async () => {
  const id = await visit(noConsent);
  expect((await run('finish_visit', { queueEntryId: id })).feedback.state).toBe('no_permission');
  expect((await rows(id)).rowCount).toBe(0);
  expect(
    (await admin.query('SELECT status FROM queue_entries WHERE id=$1', [id])).rows[0].status,
  ).toBe('done');
});
it('honours settings being turned off and does not apply one doctor’s setting to another doctor', async () => {
  await run('save_feedback_preferences', policy({ enabled: false }));
  const a = await visit();
  expect((await run('finish_visit', { queueEntryId: a })).feedback.state).toBe('off');
  await run('save_feedback_preferences', policy());
  const b = await visit(patient, clinic.doctorIds[1]);
  const rec: ToolContext = {
    clinicId: clinic.clinicId,
    actor: { kind: 'staff', role: 'receptionist', userId: reception },
  };
  expect((await run('finish_visit', { queueEntryId: b }, rec)).feedback.state).toBe('off');
});
it('preserves a manual time and never recreates a cancelled check-in', async () => {
  for (const cancel of [false, true]) {
    const id = await visit();
    const date = new Date(Date.now() + 5 * 86400000).toISOString();
    const manual = await run('schedule_patient_checkin', {
      patientId: patient,
      queueEntryId: id,
      assignedTo: doctor,
      scheduledAt: date,
      language: 'en',
      consent: true,
    });
    if (cancel) await run('cancel_patient_checkin', { id: manual.checkinId });
    expect((await run('finish_visit', { queueEntryId: id })).feedback.state).toBe(
      cancel ? 'cancelled' : 'existing',
    );
    const stored = (await rows(id)).rows;
    expect(stored).toHaveLength(1);
    expect(stored[0].scheduled_at.toISOString()).toBe(date);
  }
});
it('also schedules when calling next patient completes a consultation', async () => {
  const id = await visit();
  await run('call_next_patient', {});
  expect((await rows(id)).rowCount).toBe(1);
});
it('handles concurrent finish requests without duplicate feedback', async () => {
  const id = await visit();
  const result = await Promise.allSettled([
    run('finish_visit', { queueEntryId: id }),
    run('finish_visit', { queueEntryId: id }),
  ]);
  expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect((await rows(id)).rowCount).toBe(1);
});
it('uses the doctor as the default owner and keeps already planned check-ins when settings change', async () => {
  await run(
    'save_feedback_preferences',
    policy({ assignedTo: null, delayDays: 0, sendTime: '08:00', reminder: false }),
  );
  const id = await visit();
  await run('finish_visit', { queueEntryId: id });
  const before = (await rows(id)).rows[0];
  expect(before.assigned_to).toBe(doctor);
  expect(before.scheduled_at.getTime()).toBeGreaterThan(Date.now());
  await run('save_feedback_preferences', policy({ enabled: false }));
  expect((await rows(id)).rows[0].scheduled_at).toEqual(before.scheduled_at);
});
