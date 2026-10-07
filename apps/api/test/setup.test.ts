import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { makePool } from '@sahayak/db';
import { EventBus } from '@sahayak/core';
import { LlmGate } from '@sahayak/agents';
import { buildApp } from '../src/app';

const admin = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
const pool = makePool();
let app: Awaited<ReturnType<typeof buildApp>>;
const tag = Date.now().toString(36);
const slug = `setup-${tag}`,
  slug2 = `setup2-${tag}`;
const docEmail = `owner-${tag}@t.in`;
let tok = '';
const h = () => ({ authorization: `Bearer ${tok}` });
const signup = (body: object) => app.inject({ method: 'POST', url: '/signup', payload: body });
const good = {
  inviteCode: 'invite-123',
  clinicName: 'Setup Test Clinic',
  slug,
  doctorName: 'Dr. Owner',
  adminName: 'Clinic Owner',
  email: docEmail,
  password: 'a-long-password-1',
};

beforeAll(async () => {
  process.env.SIGNUP_RATE_LIMIT = '100';
  await admin.connect();
  app = await buildApp({ pool, bus: new EventBus(''), gate: new LlmGate(null), jwtSecret: 't' });
});
afterAll(async () => {
  delete process.env.SIGNUP_INVITE_CODE;
  delete process.env.SIGNUP_RATE_LIMIT;
  await admin.query('DELETE FROM clinics WHERE slug = ANY($1)', [[slug, slug2]]);
  await admin.end();
  await pool.end();
  await app.close();
});

describe('signup (invite only)', () => {
  it('is disabled unless the server has an invite code', async () => {
    delete process.env.SIGNUP_INVITE_CODE;
    expect((await signup(good)).statusCode).toBe(404);
  });
  it('rejects a wrong invite code and weak passwords; creates the clinic otherwise', async () => {
    process.env.SIGNUP_INVITE_CODE = 'invite-123';
    expect((await signup({ ...good, inviteCode: 'nope' })).statusCode).toBe(403);
    const weak = await signup({ ...good, password: 'short' });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().message).toMatch(/at least 10/);
    const ok = await signup(good);
    expect(ok.statusCode).toBe(200);
    tok = ok.json().token;
    expect(ok.json().slug).toBe(slug);
    expect(ok.json().user.role).toBe('admin');
    const pub = (await app.inject({ url: `/public/${slug}` })).json();
    expect(pub.clinic).toBe('Setup Test Clinic');
    expect(pub.doctors).toHaveLength(1);
  });
  it('refuses a taken web name or email', async () => {
    expect((await signup({ ...good, email: `other-${tag}@t.in` })).json().error).toBe('slug_taken');
    expect((await signup({ ...good, slug: slug2 })).json().error).toBe('email_in_use');
    expect((await signup({ ...good, slug: 'Bad Slug!', email: `x-${tag}@t.in` })).statusCode).toBe(
      400,
    );
  });
  it('the new clinic starts with sensible defaults and is isolated from others', async () => {
    const s = (await app.inject({ url: '/staff/settings', headers: h() })).json();
    expect(s.intakeQuestions.length).toBe(2);
    expect(s.timings.mon).toContain('09:00');
    const demo = (await app.inject({ url: '/public/dr-sharma' })).json();
    expect(demo.doctors.map((d: any) => d.name)).not.toContain('Dr. Owner');
  });
});

describe('signup abuse protection', () => {
  it('limits attempts per address', async () => {
    process.env.SIGNUP_INVITE_CODE = 'invite-123';
    process.env.SIGNUP_RATE_LIMIT = '2';
    const codes: number[] = [];
    for (let i = 0; i < 4; i++)
      codes.push(
        (
          await app.inject({
            method: 'POST',
            url: '/signup',
            remoteAddress: '10.9.9.9',
            payload: { ...good, inviteCode: 'wrong' },
          })
        ).statusCode,
      );
    expect(codes).toEqual([403, 403, 429, 429]);
    process.env.SIGNUP_RATE_LIMIT = '100';
  });
});

describe('guided checklist', () => {
  it('shows what is missing and blocks finishing early', async () => {
    const st = (await app.inject({ url: '/staff/setup', headers: h() })).json();
    expect(st.completed).toBe(false);
    const byId = Object.fromEntries(st.items.map((i: any) => [i.id, i.ok]));
    expect(byId).toMatchObject({
      info: false,
      timings: true,
      doctor: true,
      receptionist: false,
      intake: true,
      faq: false,
      tested: false,
    });
    expect(st.readyToFinish).toBe(false);
    const done = await app.inject({ method: 'POST', url: '/staff/setup/complete', headers: h() });
    expect(done.statusCode).toBe(400);
    expect(done.json().message).toMatch(/Clinic address and phone.*A receptionist login/);
  });
  it('rename + address, a second doctor with its own WhatsApp number, and a receptionist', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/staff/settings',
      headers: h(),
      payload: { clinicName: 'Renamed Clinic', address: '5 Test Road', phone: '+911100000001' },
    });
    expect(put.json().changed).toEqual(expect.arrayContaining(['clinicName', 'address', 'phone']));
    expect((await app.inject({ url: `/public/${slug}` })).json().clinic).toBe('Renamed Clinic');
    const d2 = await app.inject({
      method: 'POST',
      url: '/staff/doctors',
      headers: h(),
      payload: {
        name: 'Dr. Second',
        speciality: 'Paediatrics',
        slotMinutes: 20,
        whatsappNumber: `+9190${tag.replace(/\D/g, '0').padEnd(8, '0').slice(0, 8)}`,
      },
    });
    expect(d2.statusCode).toBe(200);
    const dup = await app.inject({
      method: 'POST',
      url: '/staff/doctors',
      headers: h(),
      payload: {
        name: 'Dr. Third',
        whatsappNumber: `+9190${tag.replace(/\D/g, '0').padEnd(8, '0').slice(0, 8)}`,
      },
    });
    expect(dup.json().error).toBe('number_in_use');
    const weak = await app.inject({
      method: 'POST',
      url: '/staff/team',
      headers: h(),
      payload: { email: `rec-${tag}@t.in`, name: 'Reena', role: 'receptionist', password: 'short' },
    });
    expect(weak.statusCode).toBe(400);
    const rec = await app.inject({
      method: 'POST',
      url: '/staff/team',
      headers: h(),
      payload: {
        email: `Rec-${tag}@T.in`,
        name: 'Reena',
        role: 'receptionist',
        password: 'temp-password-9',
      },
    });
    expect(rec.statusCode).toBe(200);
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: `rec-${tag}@t.in`, password: 'temp-password-9' },
    });
    expect(login.json().user.role).toBe('receptionist');
    // a receptionist cannot manage the team or setup
    const rt = { authorization: `Bearer ${login.json().token}` };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/staff/team',
          headers: rt,
          payload: {
            email: `z-${tag}@t.in`,
            name: 'Z',
            role: 'receptionist',
            password: 'temp-password-9',
          },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'POST', url: '/staff/setup/complete', headers: rt })).statusCode,
    ).toBe(403);
  });
  it('safeguards: cannot remove yourself, the last doctor, or deactivate the only active doctor', async () => {
    const me = (await app.inject({ url: '/me', headers: h() })).json();
    expect(
      (await app.inject({ method: 'DELETE', url: `/staff/team/${me.uid}`, headers: h() })).json()
        .error,
    ).toBe('self');
    const docs = (await app.inject({ url: '/staff/doctors/all', headers: h() })).json();
    const second = docs.find((d: any) => d.name === 'Dr. Second');
    await app.inject({
      method: 'PATCH',
      url: `/staff/doctors/${second.id}`,
      headers: h(),
      payload: { active: false },
    });
    const first = docs.find((d: any) => d.name === 'Dr. Owner');
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/staff/doctors/${first.id}`,
          headers: h(),
          payload: { active: false },
        })
      ).json().error,
    ).toBe('last_doctor');
    await app.inject({
      method: 'PATCH',
      url: `/staff/doctors/${second.id}`,
      headers: h(),
      payload: { active: true },
    });
  });
  it('can finish once the required items are done', async () => {
    const doctors = (await app.inject({ url: '/staff/doctors/all', headers: h() })).json();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/staff/team',
          headers: h(),
          payload: {
            name: 'Dr Owner',
            email: `doctor-${tag}@t.in`,
            role: 'doctor',
            doctorId: doctors[0].id,
            password: 'doctor-password-123',
          },
        })
      ).statusCode,
    ).toBe(200);
    const st = (await app.inject({ url: '/staff/setup', headers: h() })).json();
    expect(st.readyToFinish).toBe(true);
    expect(
      (await app.inject({ method: 'POST', url: '/staff/setup/complete', headers: h() })).statusCode,
    ).toBe(200);
    expect((await app.inject({ url: '/staff/setup', headers: h() })).json().completed).toBe(true);
  });
  it('removing a login keeps the history it created', async () => {
    const team = (await app.inject({ url: '/staff/team', headers: h() })).json().staff;
    const rec = team.find((x: any) => x.role === 'receptionist');
    expect(
      (await app.inject({ method: 'DELETE', url: `/staff/team/${rec.id}`, headers: h() }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email: `rec-${tag}@t.in`, password: 'temp-password-9' },
        })
      ).statusCode,
    ).toBe(401);
  });
});
