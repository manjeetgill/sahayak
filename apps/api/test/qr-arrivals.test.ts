import { randomBytes } from 'node:crypto';
import { beforeAll, afterAll, it, expect } from 'vitest';
import pg from 'pg';
import { createTestClinic, dropTestClinic, hashPassword, makePool } from '@sahayak/db';
import { EventBus, callTool } from '@sahayak/core';
import { LlmGate } from '@sahayak/agents';
import { buildApp } from '../src/app';

const db = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL }),
  pool = makePool(),
  bus = new EventBus('');
let clinic: Awaited<ReturnType<typeof createTestClinic>>,
  other: typeof clinic,
  app: Awaited<ReturnType<typeof buildApp>>;
const tokens: Record<string, string> = {},
  users: Record<string, string> = {};
const req = (role: string, method: any, url: string, payload?: any) =>
  app.inject({
    method,
    url,
    payload,
    headers: role ? { authorization: `Bearer ${tokens[role]}` } : {},
  });
let phone = 100;
const input = (extra = {}) => ({
  name: 'Synthetic QR patient',
  phone: `+91990000${++phone}00`,
  doctorId: clinic.doctorIds[0],
  language: 'en',
  consent: { visit_data: true, whatsapp_messaging: false, reminders_followups: false },
  accessToken: randomBytes(32).toString('hex'),
  ...extra,
});
const submit = (i: any) => req('', 'POST', `/public/${clinic.slug}/arrival`, i);
const receipt = (i: any, slug = clinic.slug) =>
  req('', 'POST', `/public/${slug}/arrival/status`, { accessToken: i.accessToken });
const settings = (extra = {}) => ({
  enabled: true,
  amountPaise: 50000,
  publicWebUrl: 'http://192.168.1.5:3000',
  ...extra,
});
const row = async (i: any) =>
  (
    await db.query(
      'SELECT a.* FROM qr_arrivals a JOIN patients p ON p.id=a.patient_id WHERE p.phone=$1 AND a.clinic_id=$2 ORDER BY a.created_at DESC',
      [i.phone, clinic.clinicId],
    )
  ).rows[0];
const confirm = (id: string, extra = {}) =>
  req('receptionist', 'POST', `/staff/qr-arrivals/${id}/confirm`, {
    method: 'cash',
    confirmed: true,
    ...extra,
  });
beforeAll(async () => {
  await db.connect();
  clinic = await createTestClinic(db, 'qr');
  other = await createTestClinic(db, 'qr-other');
  const hash = await hashPassword('qr-test-password');
  for (const role of ['admin', 'doctor', 'receptionist']) {
    users[role] = (
      await db.query(
        'INSERT INTO staff_users(clinic_id,email,name,role,password_hash,doctor_id) VALUES($1,$2,$3,$3,$4,$5) RETURNING id',
        [
          clinic.clinicId,
          `${role}-${clinic.slug}@test.invalid`,
          role,
          hash,
          role === 'doctor' ? clinic.doctorIds[0] : null,
        ],
      )
    ).rows[0].id;
  }
  app = await buildApp({ pool, bus, gate: new LlmGate(null), jwtSecret: 'qr-test' });
  for (const role of Object.keys(users))
    tokens[role] = (
      await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: `${role}-${clinic.slug}@test.invalid`, password: 'qr-test-password' },
      })
    ).json().token;
});
afterAll(async () => {
  await app.close();
  await dropTestClinic(db, clinic.clinicId);
  await dropTestClinic(db, other.clinicId);
  await pool.end();
  await db.end();
});
it('requires admin setup, allows Admin review and keeps arrival data private from public users', async () => {
  expect((await submit(input())).statusCode).toBe(400);
  expect((await req('doctor', 'PUT', '/staff/qr-settings', settings())).statusCode).toBe(403);
  expect(
    (
      await req(
        'admin',
        'PUT',
        '/staff/qr-settings',
        settings({ publicWebUrl: 'http://localhost:3000' }),
      )
    ).statusCode,
  ).toBe(400);
  expect((await req('admin', 'PUT', '/staff/qr-settings', settings())).statusCode).toBe(200);
  expect((await req('admin', 'GET', '/staff/qr-settings')).json().enabled).toBe(true);
  expect((await req('admin', 'GET', '/staff/qr-arrivals')).statusCode).toBe(200);
  expect((await req('', 'GET', '/staff/qr-arrivals')).statusCode).toBe(401);
});
it('requires consent, rejects foreign doctors and amount tampering', async () => {
  expect(
    (
      await submit(
        input({
          consent: { visit_data: false, whatsapp_messaging: false, reminders_followups: false },
        }),
      )
    ).statusCode,
  ).toBe(400);
  expect((await submit(input({ doctorId: other.doctorIds[0] }))).statusCode).toBe(404);
  expect((await submit(input({ amountPaise: 1 }))).statusCode).toBe(400);
});
it('submits privately without payment or queue; confirms atomically once despite concurrent retries', async () => {
  const i = input();
  expect((await submit(i)).statusCode).toBe(200);
  expect((await submit(i)).statusCode).toBe(200);
  const a = await row(i);
  expect(a.status).toBe('awaiting_payment');
  expect(a.queue_entry_id).toBeNull();
  expect(a.charge_id).toBeNull();
  const privateStatus = await receipt(i);
  expect(privateStatus.headers['cache-control']).toContain('no-store');
  expect(privateStatus.json()).toMatchObject({
    status: 'awaiting_payment',
    paidPaise: 0,
    amountPaise: 50000,
  });
  expect(privateStatus.body).not.toContain(i.phone);
  expect(privateStatus.body).not.toContain(i.name);
  expect((await receipt(i, other.slug)).statusCode).toBe(410);
  expect(
    (
      await req('', 'POST', `/staff/qr-arrivals/${a.id}/confirm`, {
        method: 'cash',
        confirmed: true,
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await req('admin', 'POST', `/staff/qr-arrivals/${a.id}/confirm`, {
        method: 'cash',
        confirmed: true,
      })
    ).statusCode,
  ).toBe(403);
  expect((await confirm(a.id, { confirmed: false })).statusCode).toBe(400);
  expect((await confirm(a.id, { amountPaise: 1 })).statusCode).toBe(400);
  await req('admin', 'PUT', '/staff/qr-settings', settings({ amountPaise: 60000 }));
  const responses = await Promise.all([confirm(a.id), confirm(a.id)]);
  for (const r of responses) expect(r.statusCode, r.body).toBe(200);
  const paid = await row(i);
  expect(paid.status).toBe('queued');
  expect(
    (await db.query('SELECT * FROM clinic_payments WHERE charge_id=$1', [paid.charge_id])).rows,
  ).toHaveLength(1);
  expect(
    (await db.query('SELECT * FROM queue_entries WHERE patient_id=$1', [a.patient_id])).rows,
  ).toHaveLength(1);
  expect((await receipt(i)).json()).toMatchObject({
    status: 'queued',
    paidPaise: 50000,
    amountPaise: 50000,
    visitStatus: 'waiting',
  });
  const listing = (await req('receptionist', 'GET', '/staff/qr-arrivals'))
    .json()
    .arrivals.find((r: any) => r.id === a.id);
  expect(listing.paid_paise).toBe(50000);
  await db.query('UPDATE clinic_payments SET voided_at=now() WHERE charge_id=$1', [paid.charge_id]);
  expect((await receipt(i)).json().paidPaise).toBe(0);
});
it('updates private status through consultation completion and automatic feedback scheduling', async () => {
  const i = input({
    consent: { visit_data: true, whatsapp_messaging: true, reminders_followups: true },
  });
  expect((await submit(i)).statusCode).toBe(200);
  const a = await row(i);
  expect((await confirm(a.id)).statusCode).toBe(200);
  const ctx = {
    clinicId: clinic.clinicId,
    actor: {
      kind: 'staff' as const,
      role: 'doctor' as const,
      userId: users.doctor,
      doctorId: clinic.doctorIds[0],
    },
  };
  await callTool({ pool, bus }, ctx, 'save_feedback_preferences', {
    enabled: true,
    delayDays: 1,
    sendTime: '18:00',
    assignedTo: null,
    reminder: false,
  });
  const queued = await row(i);
  await db.query("UPDATE queue_entries SET status='in_consultation' WHERE id=$1", [
    queued.queue_entry_id,
  ]);
  expect((await receipt(i)).json().visitStatus).toBe('in_consultation');
  await callTool({ pool, bus }, ctx, 'finish_visit', { queueEntryId: queued.queue_entry_id });
  expect((await receipt(i)).json()).toMatchObject({
    visitStatus: 'done',
    feedbackAt: expect.any(String),
  });
  const audit = await db.query(
    "SELECT input,output FROM agent_actions WHERE clinic_id=$1 AND tool IN ('submit_qr_arrival','read_qr_arrival')",
    [clinic.clinicId],
  );
  expect(JSON.stringify(audit.rows)).not.toContain(i.accessToken);
});
it('blocks expired/cancelled arrivals and a second payment when another channel already queued the patient', async () => {
  for (const mode of ['expired', 'cancelled', 'queued']) {
    const i = input();
    expect((await submit(i)).statusCode).toBe(200);
    const a = await row(i);
    if (mode === 'expired')
      await db.query("UPDATE qr_arrivals SET expires_at=now()-interval '1 second' WHERE id=$1", [
        a.id,
      ]);
    if (mode === 'cancelled')
      expect(
        (await req('receptionist', 'POST', `/staff/qr-arrivals/${a.id}/cancel`, {})).statusCode,
      ).toBe(200);
    if (mode === 'queued')
      await callTool(
        { pool, bus },
        { clinicId: clinic.clinicId, actor: { kind: 'patient' } },
        'check_in_patient',
        i,
      );
    expect((await confirm(a.id)).statusCode).toBe(400);
    expect(
      (await db.query('SELECT * FROM clinic_charges WHERE patient_id=$1', [a.patient_id])).rowCount,
    ).toBe(0);
  }
});
it('receipt refreshes do not exhaust the shared submission budget on clinic Wi-Fi', async () => {
  const i = input();
  expect((await submit(i)).statusCode).toBe(200);
  for (let n = 0; n < 35; n++) expect((await receipt(i)).statusCode).toBe(200);
  expect((await submit(input())).statusCode).toBe(200);
});
