import { beforeAll, afterAll, expect, it } from 'vitest';
import pg from 'pg';
import { addPatient, createTestClinic, dropTestClinic, makePool } from '@sahayak/db';
import { callTool, EventBus, registerAllTools, type ToolContext } from '../src';

const admin = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
const pool = makePool();
const rt = { pool, bus: new EventBus('') };
let clinic: Awaited<ReturnType<typeof createTestClinic>>;
let other: typeof clinic;
let patient: string;
let otherPatient: string;
let ctx: ToolContext;
const run = (name: string, input: unknown, context = ctx) => callTool(rt, context, name, input);

beforeAll(async () => {
  await admin.connect();
  registerAllTools();
  clinic = await createTestClinic(admin, 'consultation-aids');
  other = await createTestClinic(admin, 'consultation-aids-other');
  const userId = (
    await admin.query(
      "INSERT INTO staff_users(clinic_id,email,password_hash,name,role,doctor_id) VALUES ($1,$2,'unused','Test doctor','doctor',$3) RETURNING id",
      [clinic.clinicId, `${clinic.slug}@test.invalid`, clinic.doctorIds[0]],
    )
  ).rows[0].id;
  ctx = {
    clinicId: clinic.clinicId,
    actor: {
      kind: 'staff',
      role: 'doctor',
      userId,
      doctorId: clinic.doctorIds[0],
    },
  };
  patient = await addPatient(admin, clinic.clinicId, 'Consent test', '+199900004201');
  otherPatient = await addPatient(admin, other.clinicId, 'Other clinic', '+199900004202');
});
afterAll(async () => {
  if (clinic) await dropTestClinic(admin, clinic.clinicId);
  if (other) await dropTestClinic(admin, other.clinicId);
  await admin.end();
  await pool.end();
});

it('requires recorded same-patient consent for conversation notes', async () => {
  await expect(
    run('save_visit_note_draft', {
      patientId: patient,
      source: 'conversation',
      transcript: 'Patient: fever',
      note: { complaint: 'Patient said: fever' },
    }),
  ).rejects.toThrow(/consent/i);
  await expect(run('start_conversation_capture', { patientId: otherPatient })).rejects.toThrow();
  const consent = await run('start_conversation_capture', { patientId: patient });
  await run('stop_conversation_capture', { consentId: consent.consentId });
  const saved = await run('save_visit_note_draft', {
    patientId: patient,
    source: 'conversation',
    captureConsentId: consent.consentId,
    transcript: 'Patient: fever',
    note: { complaint: 'Patient said: fever' },
  });
  expect(saved.noteId).toBeTruthy();
  const record = await run('get_patient_record', { patientId: patient });
  expect(record.notes[0].capture_consent_id).toBe(consent.consentId);
  await run('erase_patient_data', { patientId: patient });
  expect((await admin.query(
    'SELECT id FROM consultation_capture_consents WHERE patient_id=$1', [patient],
  )).rowCount).toBe(0);
});

it('lets only the doctor manage their name-only medicine list', async () => {
  const original = await run('list_medicine_catalog', {});
  expect(original.starter).toContain('Paracetamol');
  const custom = await run('add_medicine_name', { name: 'Doctor selected generic' });
  expect((await run('list_medicine_catalog', {})).custom).toEqual([
    { id: custom.id, name: 'Doctor selected generic' },
  ]);
  await expect(
    run(
      'list_medicine_catalog',
      {},
      { ...ctx, actor: { kind: 'staff', role: 'receptionist', userId: (ctx.actor as any).userId } },
    ),
  ).rejects.toThrow();
  await run('remove_medicine_name', { id: custom.id });
  expect((await run('list_medicine_catalog', {})).custom).toEqual([]);
});
