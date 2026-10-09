import { afterAll, beforeAll, expect, it } from 'vitest';
import pg from 'pg';
import { addPatient, createTestClinic, dropTestClinic, hashPassword, makePool } from '@sahayak/db';
import { EventBus, callTool, registerAllTools } from '@sahayak/core';
import { LlmGate } from '@sahayak/agents';
import { buildApp } from '../src/app';

const db = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
const pool = makePool();
const bus = new EventBus('');
let clinic: Awaited<ReturnType<typeof createTestClinic>>;
let other: typeof clinic;
let app: Awaited<ReturnType<typeof buildApp>>;
let doctorUserId = '';
let doctorToken = '';
let patientId = '';
let otherPatientId = '';
const request = (method: any, url: string, payload?: any, token = doctorToken) =>
  app.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
beforeAll(async () => {
  await db.connect();
  clinic = await createTestClinic(db, 'solo-work');
  other = await createTestClinic(db, 'solo-work-other');
  registerAllTools();
  doctorUserId = (await db.query(
    `INSERT INTO staff_users(clinic_id,email,password_hash,name,role,doctor_id,solo_owner)
     VALUES($1,$2,$3,'Dr Solo','doctor',$4,true) RETURNING id`,
    [clinic.clinicId, `solo-${clinic.slug}@test.invalid`, await hashPassword('solo-password'), clinic.doctorIds[0]],
  )).rows[0].id;
  await db.query("UPDATE clinic_settings SET workspace_mode='solo' WHERE clinic_id=$1", [clinic.clinicId]);
  patientId = await addPatient(db, clinic.clinicId, 'Synthetic Patient', '+919900004201', { whatsapp: false });
  otherPatientId = await addPatient(db, clinic.clinicId, 'Other Patient', '+919900004202', { whatsapp: false });
  app = await buildApp({ pool, bus, gate: new LlmGate(null), jwtSecret: 'solo-test' });
  doctorToken = (await request('POST', '/auth/login', {
    email: `solo-${clinic.slug}@test.invalid`, password: 'solo-password',
  }, '')).json().token;
});
afterAll(async () => {
  await app.close();
  await dropTestClinic(db, clinic.clinicId);
  await dropTestClinic(db, other.clinicId);
  await pool.end(); await db.end();
});

it('keeps solo availability with the owner and assigns a human handoff to that doctor', async () => {
  expect((await request('GET', '/staff/solo/availability')).json().availability).toBe('seeing_patients');
  expect((await request('PUT', '/staff/solo/availability', { availability: 'closed' })).statusCode).toBe(200);
  expect((await request('GET', '/staff/solo/availability')).json().availability).toBe('closed');
  const conversationId = (await db.query(
    `INSERT INTO conversations(clinic_id,contact,patient_id,language)
     VALUES($1,'+919900004201',$2,'en') RETURNING id`, [clinic.clinicId, patientId],
  )).rows[0].id;
  await callTool({ pool, bus }, { clinicId: clinic.clinicId, patientId, conversationId,
    actor: { kind: 'agent', agent: 'front_desk' } }, 'handoff_to_human',
    { reason: 'human_requested', summary: 'Patient asked for the doctor.' });
  const conversation = (await db.query('SELECT human_user_id,handled_by FROM conversations WHERE id=$1', [conversationId])).rows[0];
  expect(conversation).toMatchObject({ human_user_id: doctorUserId, handled_by: 'human' });
  expect((await request('GET', '/staff/inbox')).json().items.some((item: any) => item.kind === 'alert')).toBe(true);
});

it('uses a rotating private link for patient appointments and requested report upload', async () => {
  const first = await request('POST', `/staff/patients/${patientId}/access-link`, {});
  expect(first.statusCode).toBe(200);
  const firstToken = first.json().path.split('#')[1];
  const second = await request('POST', `/staff/patients/${patientId}/access-link`, {});
  expect(second.statusCode).toBe(200);
  const token = second.json().path.split('#')[1];
  const base = `/public/${clinic.slug}/my-visit`;
  expect((await request('POST', base, { token: firstToken }, '')).statusCode).toBe(404);
  expect((await request('POST', `/public/${other.slug}/my-visit`, { token }, '')).statusCode).toBe(404);
  expect((await request('POST', base, { token }, '')).json().patientName).toBe('Synthetic Patient');
  const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const slots = await request('POST', `${base}/slots`, { token, doctorId: clinic.doctorIds[0], date }, '');
  expect(slots.statusCode, slots.body).toBe(200);
  const startsAt = slots.json().slots[0];
  expect(startsAt).toBeTruthy();
  const booked = await request('POST', `${base}/book`, { token, doctorId: clinic.doctorIds[0], startsAt }, '');
  expect(booked.statusCode, booked.body).toBe(200);
  const appointmentId = booked.json().appointmentId;
  expect((await request('POST', base, { token }, '')).json().appointments.some((a: any) => a.id === appointmentId)).toBe(true);
  const movedTo = slots.json().slots[1];
  expect(movedTo).toBeTruthy();
  const moved = await request('POST', `${base}/reschedule`, { token, appointmentId, newStartsAt: movedTo }, '');
  expect(moved.statusCode, moved.body).toBe(200);
  expect((await db.query('SELECT starts_at,source FROM appointments WHERE id=$1', [appointmentId])).rows[0])
    .toMatchObject({ starts_at: new Date(movedTo), source: 'patient_web' });
  const foreignAppointment = (await db.query(
    `INSERT INTO appointments(clinic_id,doctor_id,patient_id,starts_at,ends_at)
     VALUES($1,$2,$3,now()+interval '4 days',now()+interval '4 days 15 minutes') RETURNING id`,
    [clinic.clinicId, clinic.doctorIds[1], otherPatientId],
  )).rows[0].id;
  expect((await request('POST', `${base}/cancel`, { token, appointmentId: foreignAppointment }, '')).statusCode).toBe(403);
  expect((await request('POST', `${base}/cancel`, { token, appointmentId }, '')).statusCode).toBe(200);

  const task = await request('POST', '/staff/care-tasks', { patientId, kind: 'report',
    title: 'Bring requested report', assignedTo: doctorUserId,
    dueAt: new Date(Date.now() + 3600000).toISOString() });
  expect(task.statusCode, task.body).toBe(200);
  const careTaskId = task.json().taskId;
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF').toString('base64');
  const uploaded = await request('POST', `${base}/document`, { token, filename: 'test.pdf', base64: pdf, careTaskId }, '');
  expect(uploaded.statusCode, uploaded.body).toBe(200);
  expect((await db.query('SELECT status,document_id FROM care_tasks WHERE id=$1', [careTaskId])).rows[0])
    .toMatchObject({ status: 'received', document_id: uploaded.json().documentId });
  expect((await request('GET', '/staff/inbox')).json().items.some((item: any) => item.key === `task:${careTaskId}`)).toBe(true);
});

it('shows the end-of-day count and records review without closing unfinished tasks', async () => {
  const before = await request('GET', '/staff/solo/closeout');
  expect(before.statusCode, before.body).toBe(200);
  expect(before.json().counts.careDue).toBeGreaterThan(0);
  const done = await request('POST', '/staff/solo/closeout', { acknowledged: true });
  expect(done.statusCode, done.body).toBe(200);
  expect(done.json().reviewedAt).toBeTruthy();
  expect((await request('GET', '/staff/solo/closeout')).json().counts.careDue).toBeGreaterThan(0);
});

it('accepts a private patient follow-up reply and raises urgent concerns for doctor review', async () => {
  const dueAt = new Date(Date.now() + 3600000).toISOString();
  const plan = await request('POST', '/staff/workbench/plans', {
    patientId, title: 'Check after visit', assignedTo: doctorUserId,
    steps: [{ title: 'How are you?', message: 'Please tell us how you feel.', dueAt }],
  });
  expect(plan.statusCode, plan.body).toBe(200);
  expect((await request('POST', '/staff/workbench/plan-status', { id: plan.json().id, status: 'active' })).statusCode).toBe(200);
  const link = await request('POST', `/staff/patients/${patientId}/access-link`, {});
  const token = link.json().path.split('#')[1];
  const base = `/public/${clinic.slug}/my-visit`;
  const step = (await request('POST', base, { token }, '')).json().careSteps[0];
  expect(step.title).toBe('How are you?');
  const reply = await request('POST', `${base}/follow-up-reply`, {
    token, stepId: step.id, response: 'I have chest pain and need help',
  }, '');
  expect(reply.statusCode, reply.body).toBe(200);
  expect(reply.json().urgent).toBe(true);
  expect((await db.query('SELECT status,response FROM care_plan_steps WHERE id=$1', [step.id])).rows[0])
    .toMatchObject({ status: 'needs_review', response: 'I have chest pain and need help' });
  expect((await request('POST', `${base}/follow-up-reply`, {
    token, stepId: step.id, response: 'Another reply',
  }, '')).statusCode).toBe(409);
  const inbox = (await request('GET', '/staff/inbox')).json();
  expect(inbox.items.some((item: any) => item.key === `step:${step.id}`)).toBe(true);
  expect(inbox.urgent).toBeGreaterThan(0);
});
