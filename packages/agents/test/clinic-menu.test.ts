import { beforeAll, afterAll, it, expect } from 'vitest';
import pg from 'pg';
import { createTestClinic, dropTestClinic, makePool, addPatient } from '@sahayak/db';
import { EventBus, registerAllTools } from '@sahayak/core';
import { handleInbound, LlmGate } from '../src';
const admin = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL }),
  pool = makePool();
const env = { rt: { pool, bus: new EventBus('') }, gate: new LlmGate(null) };
let clinic: Awaited<ReturnType<typeof createTestClinic>>;
const say = (from: string, text: string) =>
  handleInbound(env, { clinicId: clinic.clinicId, from, text });
const appointments = async (phone: string) =>
  (
    await admin.query(
      'SELECT a.* FROM appointments a JOIN patients p ON p.id=a.patient_id WHERE a.clinic_id=$1 AND p.phone=$2',
      [clinic.clinicId, phone],
    )
  ).rows;
beforeAll(async () => {
  await admin.connect();
  registerAllTools();
  clinic = await createTestClinic(admin, 'menu');
});
afterAll(async () => {
  await dropTestClinic(admin, clinic.clinicId);
  await admin.end();
  await pool.end();
});
it('books a first visit from Hi with consent and explicit confirmation, persisted in the app', async () => {
  const phone = '+919544440001';
  expect((await say(phone, 'Hi')).replies[0]).toContain('1) Book an appointment');
  expect((await say(phone, 'Yes')).replies[0]).toContain('first visit');
  await say(phone, '1');
  await say(phone, 'New Patient');
  await say(phone, 'yes');
  await say(phone, '1');
  await say(phone, 'tomorrow evening');
  expect((await say(phone, '1')).replies[0]).toContain('Confirm your appointment');
  expect(await appointments(phone)).toHaveLength(0);
  const saved = (
    await admin.query('SELECT state FROM conversations WHERE clinic_id=$1 AND contact=$2', [
      clinic.clinicId,
      phone,
    ])
  ).rows[0].state;
  expect(saved.flow).toBe('confirm_clinic_slot');
  expect(saved.visitKind).toBe('first_visit');
  expect((await say(phone, 'yes')).replies[0]).toContain('is booked for');
  const rows = await appointments(phone);
  expect(rows).toHaveLength(1);
  expect(rows[0].reason).toBe('First visit');
  await say(phone, 'yes');
  expect(await appointments(phone)).toHaveLength(1);
});
it('uses a known patient for follow-up and does not book on NO', async () => {
  const phone = '+919544440002';
  await addPatient(admin, clinic.clinicId, 'Existing Patient', phone);
  await say(phone, 'Hi');
  await say(phone, '1');
  await say(phone, '2');
  await say(phone, '1');
  await say(phone, 'earliest');
  await say(phone, '1');
  await say(phone, 'no');
  expect(await appointments(phone)).toHaveLength(0);
  await say(phone, '1');
  await say(phone, 'yes');
  expect((await appointments(phone))[0].reason).toBe('Follow-up visit');
});
it('keeps safety and human takeover ahead of menu routing', async () => {
  const phone = '+919544440003';
  await say(phone, 'Hi');
  const r = await say(phone, 'chest pain');
  expect(r.redFlag).toBe(true);
  expect(await appointments(phone)).toHaveLength(0);
  const other = '+919544440004';
  await say(other, 'Hi');
  expect((await say(other, '4')).handledBy).toBe('human');
  expect((await say(other, '1')).replies).toEqual([]);
});
it('uses the Hindi menu and respects a paused assistant mid-flow', async () => {
  const phone = '+919544440005';
  expect((await say(phone, 'नमस्ते')).replies[0]).toContain('अपॉइंटमेंट');
  await say(phone, '1');
  await say(phone, '1');
  await admin.query(
    `UPDATE clinic_settings SET agents=jsonb_set(agents,'{front_desk}','false') WHERE clinic_id=$1`,
    [clinic.clinicId],
  );
  expect((await say(phone, 'New Patient')).handledBy).toBe('human');
  expect(await appointments(phone)).toHaveLength(0);
});
