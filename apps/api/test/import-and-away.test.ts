import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import {
  withClinic,
  addPatient,
  createTestClinic,
  dropTestClinic,
  hashPassword,
  makePool,
} from '@sahayak/db';
import { EventBus, registerAllTools, freeSlots } from '@sahayak/core';
import { LlmGate } from '@sahayak/agents';
import { buildApp } from '../src/app';

const admin = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
const pool = makePool();
let A: Awaited<ReturnType<typeof createTestClinic>>;
let app: Awaited<ReturnType<typeof buildApp>>;
const tok: Record<string, string> = {};
const PW = 'pw-test-1234';
const call = (who: string, method: string, url: string, payload?: object) =>
  app.inject({
    method: method as any,
    url,
    headers: { authorization: `Bearer ${tok[who]}` },
    payload,
  });

beforeAll(async () => {
  await admin.connect();
  registerAllTools();
  A = await createTestClinic(admin, 'impA');
  const pw = await hashPassword(PW);
  for (const [tag, role, doc] of [
    ['admA', 'admin', null],
    ['recA', 'receptionist', null],
    ['docA', 'doctor', A.doctorIds[0]],
  ] as const)
    await admin.query(
      'INSERT INTO staff_users (clinic_id,email,password_hash,name,role,doctor_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [A.clinicId, `${tag}-${A.slug}@t.in`.toLowerCase(), pw, tag, role, doc],
    );
  app = await buildApp({ pool, bus: new EventBus(''), gate: new LlmGate(null), jwtSecret: 't' });
  for (const k of ['admA', 'recA', 'docA'])
    tok[k] = (
      await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: `${k}-${A.slug}@t.in`.toLowerCase(), password: PW },
      })
    ).json().token;
  await addPatient(admin, A.clinicId, 'Already Here', '+919877700001');
});
afterAll(async () => {
  await dropTestClinic(admin, A.clinicId);
  await admin.end();
  await pool.end();
  await app.close();
});

const rows = [
  { name: 'Asha Rao', phone: '98777 00002', age: '40', language: 'Hindi' },
  { name: 'Bimal Das', phone: '9877700003', yearOfBirth: '1980' },
  { name: 'Again', phone: '+919877700002' },
  { name: 'Already Here', phone: '9877700001' },
  { name: '', phone: '9877700004' },
  { name: 'Bad Phone', phone: '123' },
];

describe('patient import', () => {
  it('doctors and admins cannot import; reception can', async () => {
    expect((await call('docA', 'POST', '/staff/patient-import/preview', { rows })).statusCode).toBe(
      403,
    );
    expect((await call('recA', 'POST', '/staff/patient-import/preview', { rows })).statusCode).toBe(
      200,
    );
  });
  it('preview sorts new, duplicate and invalid rows and saves nothing', async () => {
    const p = (await call('recA', 'POST', '/staff/patient-import/preview', { rows })).json();
    expect(p.counts).toEqual({
      total: 6,
      new: 2,
      duplicateExisting: 1,
      duplicateInFile: 1,
      invalid: 2,
    });
    expect(
      (await admin.query('SELECT count(*)::int n FROM patients WHERE clinic_id=$1', [A.clinicId]))
        .rows[0].n,
    ).toBe(1);
  });
  it('commit adds patients with no consents; the audit log has no names or numbers', async () => {
    const c = (await call('recA', 'POST', '/staff/patient-import/commit', { rows })).json();
    expect(c.imported).toBe(2);
    const r = await admin.query(
      `SELECT p.name,p.language,p.year_of_birth,(SELECT count(*)::int FROM consents c WHERE c.patient_id=p.id) cons
         FROM patients p WHERE import_batch=$1 ORDER BY name`,
      [c.batchId],
    );
    expect(r.rows.map((x) => [x.name, x.language, x.cons])).toEqual([
      ['Asha Rao', 'hi', 0],
      ['Bimal Das', 'en', 0],
    ]);
    expect(r.rows[1].year_of_birth).toBe(1980);
    const a = await admin.query('SELECT input,output FROM agent_actions WHERE clinic_id=$1', [
      A.clinicId,
    ]);
    expect(JSON.stringify(a.rows)).not.toMatch(/Asha|9877700002|Bimal/);
  });
  it('an imported patient must consent at first check-in, and is then recognised', async () => {
    const look = (
      await app.inject({
        method: 'POST',
        url: `/public/${A.slug}/lookup`,
        payload: { phone: '9877700002' },
      })
    ).json();
    expect(look.returning).toBe(false);
    const body = { phone: '9877700002', doctorId: A.doctorIds[0], language: 'hi', consent: {} };
    const no = await app.inject({
      method: 'POST',
      url: `/public/${A.slug}/checkin`,
      payload: body,
    });
    expect(no.statusCode).toBeGreaterThanOrEqual(400);
    const ok = await app.inject({
      method: 'POST',
      url: `/public/${A.slug}/checkin`,
      payload: { ...body, name: 'Asha', consent: { visit_data: true } },
    });
    expect(ok.statusCode).toBe(200);
    expect(
      (
        await admin.query(
          "SELECT count(*)::int n FROM patients WHERE clinic_id=$1 AND phone='+919877700002'",
          [A.clinicId],
        )
      ).rows[0].n,
    ).toBe(1);
    const look2 = (
      await app.inject({
        method: 'POST',
        url: `/public/${A.slug}/lookup`,
        payload: { phone: '9877700002' },
      })
    ).json();
    expect(look2.returning).toBe(true);
  });
  it('undo removes only unused imported patients, reception only', async () => {
    const c = (
      await call('recA', 'POST', '/staff/patient-import/commit', {
        rows: [
          { name: 'Cara', phone: '9877700010' },
          { name: 'Dev', phone: '9877700011' },
        ],
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/public/${A.slug}/checkin`,
      payload: {
        phone: '9877700011',
        doctorId: A.doctorIds[0],
        language: 'en',
        name: 'Dev',
        consent: { visit_data: true },
      },
    });
    expect((await call('docA', 'POST', `/staff/patient-import/${c.batchId}/undo`)).statusCode).toBe(
      403,
    );
    const u = (await call('recA', 'POST', `/staff/patient-import/${c.batchId}/undo`)).json();
    expect(u).toEqual({ removed: 1, kept: 1 });
  });
});

describe('doctor away', () => {
  const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const slots = (d: string) =>
    withClinic(pool, A.clinicId, (db) => freeSlots(db, A.clinicId, A.doctorIds[0], d, 10));
  it('blocks slots on those days, lists existing bookings, and reopens on removal', async () => {
    const doc = A.doctorIds[0];
    expect((await slots(day(3))).length).toBeGreaterThan(0);
    const patient = (
      await admin.query('SELECT id FROM patients WHERE clinic_id=$1 LIMIT 1', [A.clinicId])
    ).rows[0].id;
    await admin.query(
      "INSERT INTO appointments (clinic_id,doctor_id,patient_id,starts_at,ends_at,source) VALUES ($1,$2,$3,$4,$4::timestamptz + interval '10 minutes','manual')",
      [A.clinicId, doc, patient, new Date(Date.now() + 3 * 864e5).toISOString()],
    );
    const add = await call('recA', 'POST', '/staff/leave', {
      doctorId: doc,
      startsOn: day(1),
      endsOn: day(5),
    });
    expect(add.statusCode).toBe(200);
    expect(add.json().affected.length).toBe(1);
    expect(await slots(day(3))).toEqual([]);
    expect((await slots(day(7))).length).toBeGreaterThan(0);
    // a doctor manages only their own leave
    expect(
      (
        await call('docA', 'POST', '/staff/leave', {
          doctorId: A.doctorIds[1],
          startsOn: day(1),
          endsOn: day(2),
        })
      ).statusCode,
    ).toBe(403);
    const mine = await call('docA', 'POST', '/staff/leave', { startsOn: day(20), endsOn: day(21) });
    expect(mine.statusCode).toBe(200);
    // the booking can be cancelled one by one
    const aff = add.json().affected[0];
    expect((await call('recA', 'POST', `/staff/appointments/${aff.id}/cancel`)).statusCode).toBe(
      200,
    );
    const list = (await call('recA', 'GET', `/staff/leave?doctorId=${doc}`)).json().leave;
    for (const l of list)
      expect((await call('recA', 'DELETE', `/staff/leave/${l.id}`)).statusCode).toBe(200);
    expect((await slots(day(3))).length).toBeGreaterThan(0);
    // public page shows who is away today
    await call('recA', 'POST', '/staff/leave', {
      doctorId: doc,
      startsOn: day(-1),
      endsOn: day(1),
    });
    const pub = (await app.inject({ method: 'GET', url: `/public/${A.slug}` })).json();
    expect(pub.doctors.find((d: any) => d.id === doc).awayUntil).toBe(day(1));
  });
});

describe('share and grow', () => {
  it('counts new patients by the link they used; bad source values are dropped', async () => {
    const go = (phone: string, source?: string) =>
      app.inject({
        method: 'POST',
        url: `/public/${A.slug}/checkin`,
        payload: {
          phone,
          name: 'Src',
          doctorId: A.doctorIds[0],
          consent: { visit_data: true },
          source,
        },
      });
    expect((await go('9877700020', 'whatsapp')).statusCode).toBe(200);
    expect((await go('9877700021', 'whatsapp')).statusCode).toBe(200);
    expect((await go('9877700022', 'Insta gram <script>')).statusCode).toBe(200);
    const g = (await call('docA', 'GET', '/staff/growth')).json();
    expect(g.slug).toBe(A.slug);
    expect(g.sources.find((s: any) => s.source === 'whatsapp').patients).toBe(2);
    expect(g.sources.find((s: any) => s.source === 'other').patients).toBeGreaterThanOrEqual(1);
    expect((await call('admA', 'GET', '/staff/growth')).statusCode).toBe(403);
  });
});
