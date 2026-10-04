import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { createTestClinic, dropTestClinic, hashPassword, makePool } from '@sahayak/db';
import { EventBus } from '@sahayak/core';
import { LlmGate } from '@sahayak/agents';
import { buildApp } from '../src/app';

const admin = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
const pool = makePool();
let app: Awaited<ReturnType<typeof buildApp>>;
let A: Awaited<ReturnType<typeof createTestClinic>>,
  B: Awaited<ReturnType<typeof createTestClinic>>;
const tokens: Record<string, string> = {};

beforeAll(async () => {
  await admin.connect();
  A = await createTestClinic(admin, 'apia');
  B = await createTestClinic(admin, 'apib');
  const pw = await hashPassword('pw-test-1234');
  const mk = (clinic: string, email: string, role: string, doc: string | null) =>
    admin.query(
      'INSERT INTO staff_users (clinic_id,email,password_hash,name,role,doctor_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [clinic, email, pw, email, role, doc],
    );
  await mk(A.clinicId, `doca-${A.slug}@t.in`, 'doctor', A.doctorIds[0]);
  await mk(A.clinicId, `reca-${A.slug}@t.in`, 'receptionist', null);
  await mk(B.clinicId, `recb-${B.slug}@t.in`, 'receptionist', null);
  app = await buildApp({ pool, bus: new EventBus(''), gate: new LlmGate(null), jwtSecret: 'test' });
  for (const [k, email] of [
    ['docA', `doca-${A.slug}@t.in`],
    ['recA', `reca-${A.slug}@t.in`],
    ['recB', `recb-${B.slug}@t.in`],
  ]) {
    const r = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'pw-test-1234' },
    });
    if (r.statusCode !== 200) throw new Error('login failed ' + r.body);
    tokens[k] = r.json().token;
  }
});
afterAll(async () => {
  await dropTestClinic(admin, A.clinicId);
  await dropTestClinic(admin, B.clinicId);
  await admin.end();
  await pool.end();
  await app.close();
});
const h = (k: string) => ({ authorization: `Bearer ${tokens[k]}` });

describe('auth', () => {
  it('rejects wrong password and unauthenticated calls', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email: `reca-${A.slug}@t.in`, password: 'nope' },
        })
      ).statusCode,
    ).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/staff/queue' })).statusCode).toBe(401);
  });
  it('doctors cannot use receptionist-only endpoints', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/staff/conversations', headers: h('docA') }))
        .statusCode,
    ).toBe(403);
  });
});

describe('patient check-in → queue → doctor', () => {
  it('new patient needs consent', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/public/${A.slug}/checkin`,
      payload: { name: 'X', phone: '9811100001', doctorId: A.doctorIds[0], consent: {} },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('consent_required');
  });
  it('issues tokens in order, recognises returning patients, and the doctor calls the next one', async () => {
    const ci = (name: string, phone: string) =>
      app.inject({
        method: 'POST',
        url: `/public/${A.slug}/checkin`,
        payload: {
          name,
          phone,
          doctorId: A.doctorIds[0],
          language: 'en',
          consent: { visit_data: true, whatsapp_messaging: true },
        },
      });
    expect((await ci('Asha', '9811100002')).json().token).toBe(1);
    expect((await ci('Bala', '9811100003')).json().token).toBe(2);
    const again = (await ci('Asha', '9811100002')).json();
    expect(again.token).toBe(1); // idempotent, still same token
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/public/${A.slug}/lookup`,
          payload: { phone: '9811100002' },
        })
      ).json(),
    ).toEqual({ returning: true });
    const board0 = (await app.inject({ url: `/public/${A.slug}/board` })).json();
    expect(board0.doctors[0].next).toEqual([1, 2]);
    const call = await app.inject({
      method: 'POST',
      url: '/staff/queue/call-next',
      headers: h('docA'),
      payload: {},
    });
    expect(call.json().patient).toMatchObject({ name: 'Asha', token: 1 });
    const board = (await app.inject({ url: `/public/${A.slug}/board` })).json();
    expect(board.doctors[0].nowServing).toBe(1);
    expect(board.doctors[0].next).toEqual([2]);
  });
  it('clinic B staff cannot see or act on clinic A queue entries', async () => {
    const q = (await app.inject({ url: '/staff/queue', headers: h('recA') })).json();
    expect(q.length).toBe(2);
    expect((await app.inject({ url: '/staff/queue', headers: h('recB') })).json()).toEqual([]);
    const r = await app.inject({
      method: 'POST',
      url: `/staff/queue/${q[0].id}/skip`,
      headers: h('recB'),
    });
    expect(r.statusCode).toBe(404);
  });
  it('simulator: patient message gets an agent reply and shows in the receptionist console', async () => {
    // Asha consented to messages, so the intake agent is already asking questions in her chat.
    const intake = await app.inject({
      method: 'POST',
      url: `/sim/${A.slug}/message`,
      payload: { from: '9811100002', text: 'fever for two days' },
    });
    expect(intake.json().replies.join(' ')).toMatch(/Since when/);
    await app.inject({
      method: 'POST',
      url: `/sim/${A.slug}/message`,
      payload: { from: '9811100002', text: 'two days' },
    });
    const r = await app.inject({
      method: 'POST',
      url: `/sim/${A.slug}/message`,
      payload: { from: '9811100002', text: 'what is my token?' },
    });
    expect(r.json().replies[0]).toMatch(/token/i);
    const convs = (await app.inject({ url: '/staff/conversations', headers: h('recA') })).json();
    expect(convs.some((c: any) => c.contact === '+919811100002')).toBe(true);
  });
  it('red flag via simulator creates an urgent flag the console can see', async () => {
    await app.inject({
      method: 'POST',
      url: `/sim/${A.slug}/message`,
      payload: { from: '9811100003', text: 'chest pain!' },
    });
    const flags = (await app.inject({ url: '/staff/flags', headers: h('recA') })).json();
    expect(flags[0]).toMatchObject({ kind: 'red_flag', severity: 'urgent' });
    expect((await app.inject({ url: '/staff/flags', headers: h('recB') })).json()).toEqual([]);
  });
});

describe('privacy requests at the desk', () => {
  it('receptionist finds a patient, exports a copy, erases; clinic B cannot', async () => {
    await app.inject({ method: 'POST', url: `/public/${A.slug}/checkin`, payload: { name: 'Desk Privacy', phone: '9811100077', doctorId: A.doctorIds[0], consent: { visit_data: true } } });
    const found = (await app.inject({ url: '/staff/patients?phone=9811100077', headers: h('recA') })).json();
    expect(found).toHaveLength(1);
    expect((await app.inject({ url: '/staff/patients?phone=9811100077', headers: h('recB') })).json()).toEqual([]);
    const exp = await app.inject({ url: `/staff/patients/${found[0].id}/export`, headers: h('recA') });
    expect(exp.headers['content-disposition']).toMatch(/patient-data\.json/);
    expect(exp.json().patient.name).toBe('Desk Privacy');
    expect((await app.inject({ url: `/staff/patients/${found[0].id}/export`, headers: h('recB') })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/staff/patients/${found[0].id}/erase`, headers: h('recB') })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/staff/patients/${found[0].id}/erase`, headers: h('recA') })).statusCode).toBe(200);
    expect((await app.inject({ url: '/staff/patients?phone=9811100077', headers: h('recA') })).json()).toEqual([]);
  });
});
