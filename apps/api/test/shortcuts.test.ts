import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { addPatient, createTestClinic, dropTestClinic, hashPassword, makePool } from '@sahayak/db';
import { EventBus, registerAllTools } from '@sahayak/core';
import { LlmGate } from '@sahayak/agents';
import { buildApp } from '../src/app';

const admin = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
const pool = makePool();
let A: Awaited<ReturnType<typeof createTestClinic>>,
  B: Awaited<ReturnType<typeof createTestClinic>>;
let app: Awaited<ReturnType<typeof buildApp>>;
const tok: Record<string, string> = {};
const h = (k: string) => ({ authorization: `Bearer ${tok[k]}` });
const PW = 'pw-test-1234';
let patient = '';

const call = (who: string, method: string, url: string, payload?: object) =>
  app.inject({ method: method as any, url, headers: h(who), payload });

beforeAll(async () => {
  await admin.connect();
  registerAllTools();
  A = await createTestClinic(admin, 'scA');
  B = await createTestClinic(admin, 'scB');
  const pw = await hashPassword(PW);
  const mk = (cl: typeof A, doc: string | null, role: string, tag: string) =>
    admin.query(
      'INSERT INTO staff_users (clinic_id,email,password_hash,name,role,doctor_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [cl.clinicId, `${tag}-${cl.slug}@t.in`.toLowerCase(), pw, tag, role, doc],
    );
  await mk(A, A.doctorIds[0], 'doctor', 'docA');
  await mk(A, A.doctorIds[1], 'doctor', 'docA2');
  await mk(A, null, 'receptionist', 'recA');
  await mk(B, B.doctorIds[0], 'doctor', 'docB');
  await admin.query('UPDATE doctors SET registration_no=$2 WHERE id=$1', [A.doctorIds[0], 'PMC-1']);
  app = await buildApp({ pool, bus: new EventBus(''), gate: new LlmGate(null), jwtSecret: 't' });
  for (const [k, cl] of [
    ['docA', A],
    ['docA2', A],
    ['recA', A],
    ['docB', B],
  ] as const)
    tok[k] = (
      await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: `${k}-${cl.slug}@t.in`.toLowerCase(), password: PW },
      })
    ).json().token;
  patient = await addPatient(admin, A.clinicId, 'Repeat Patient', '+919866600001');
});
afterAll(async () => {
  await dropTestClinic(admin, A.clinicId);
  await dropTestClinic(admin, B.clinicId);
  await admin.end();
  await pool.end();
  await app.close();
});

describe('visit templates', () => {
  it('are for doctors only', async () => {
    expect((await call('recA', 'GET', '/staff/shortcuts')).statusCode).toBe(403);
    expect((await call('recA', 'POST', '/staff/shortcuts/starter')).statusCode).toBe(403);
  });
  it('starter templates contain headings and blanks only, and are added once', async () => {
    expect((await call('docA', 'POST', '/staff/shortcuts/starter')).json().added).toBe(3);
    expect((await call('docA', 'POST', '/staff/shortcuts/starter')).json().added).toBe(0);
    const { templates } = (await call('docA', 'GET', '/staff/shortcuts')).json();
    expect(templates.map((t: any) => t.name)).toEqual([
      'Fever',
      'Follow-up visit',
      'General visit',
    ]);
    for (const t of templates) {
      // no medicine, dose, diagnosis or advice is pre-filled: every line is a heading plus a blank
      expect(t.body).toMatch(/___/);
      expect(t.body).not.toMatch(/paracetamol|\bmg\b|antibiotic|rest and|fluids/i);
    }
  });
  it('saving the same name (any case) replaces it; deleting works; another doctor never sees mine', async () => {
    await call('docA', 'POST', '/staff/shortcuts/templates', {
      name: 'BP follow-up',
      body: 'Complaint: ___\nExamination: BP ___',
    });
    await call('docA', 'POST', '/staff/shortcuts/templates', {
      name: 'bp FOLLOW-UP',
      body: 'Examination: BP ___ pulse ___',
    });
    const mine = (await call('docA', 'GET', '/staff/shortcuts'))
      .json()
      .templates.filter((t: any) => /bp/i.test(t.name));
    expect(mine).toHaveLength(1);
    expect(mine[0].body).toMatch(/pulse/);
    expect((await call('docA2', 'GET', '/staff/shortcuts')).json().templates).toEqual([]);
    expect(
      (await call('docA2', 'DELETE', `/staff/shortcuts/templates/${mine[0].id}`)).statusCode,
    ).toBe(404);
    expect(
      (await call('docB', 'DELETE', `/staff/shortcuts/templates/${mine[0].id}`)).statusCode,
    ).toBe(404);
    expect(
      (await call('docA', 'DELETE', `/staff/shortcuts/templates/${mine[0].id}`)).statusCode,
    ).toBe(200);
  });
  it('keeps at most 30 and validates input', async () => {
    for (let i = 0; i < 27; i++)
      await call('docA', 'POST', '/staff/shortcuts/templates', {
        name: `Extra ${i}`,
        body: 'Complaint: ___',
      });
    const over = await call('docA', 'POST', '/staff/shortcuts/templates', {
      name: 'One too many',
      body: 'x',
    });
    expect(over.json().error).toBe('too_many');
    expect(
      (await call('docA', 'POST', '/staff/shortcuts/templates', { name: 'x', body: '' }))
        .statusCode,
    ).toBe(400);
  });
  it('template wording stays out of the audit log', async () => {
    await call('docA2', 'POST', '/staff/shortcuts/templates', {
      name: 'Secret skeleton',
      body: 'Complaint: unique-wording-xyz ___',
    });
    const all = JSON.stringify(
      (
        await admin.query('SELECT input, output FROM agent_actions WHERE clinic_id=$1', [
          A.clinicId,
        ])
      ).rows,
    );
    expect(all).not.toContain('unique-wording-xyz');
  });
});

describe('favourite medicines', () => {
  it('saves one medicine line exactly as written and warns when frequency or duration is missing', async () => {
    const ok = await call('docA', 'POST', '/staff/shortcuts/medicines', {
      line: 'tab paracetamol 500 mg twice a day for 3 days',
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().incomplete).toEqual([]);
    const partial = await call('docA', 'POST', '/staff/shortcuts/medicines', {
      line: 'tab cetirizine 10 mg',
    });
    expect(partial.json().incomplete.join(' ')).toMatch(/not found/);
    const list = (await call('docA', 'GET', '/staff/shortcuts'))
      .json()
      .medicines.map((m: any) => m.line);
    expect(list).toContain('tab paracetamol 500 mg twice a day for 3 days');
  });
  it('is one medicine per line, idempotent, and private to the doctor', async () => {
    expect(
      (
        await call('docA', 'POST', '/staff/shortcuts/medicines', {
          line: 'tab a 5 mg bd for 2 days\ntab b 5 mg bd for 2 days',
        })
      ).json().error,
    ).toBe('one_line');
    await call('docA', 'POST', '/staff/shortcuts/medicines', {
      line: 'tab paracetamol 500 mg twice a day for 3 days',
    });
    expect(
      (await call('docA', 'GET', '/staff/shortcuts'))
        .json()
        .medicines.filter((m: any) => /paracetamol/.test(m.line)),
    ).toHaveLength(1);
    expect((await call('docA2', 'GET', '/staff/shortcuts')).json().medicines).toEqual([]);
  });
});

describe('repeat last prescription', () => {
  it('has nothing to repeat for a patient without a signed prescription', async () => {
    const r = await call('docA', 'POST', `/staff/patients/${patient}/prescriptions/repeat`, {});
    expect(r.statusCode).toBe(404);
    expect(r.json().error).toBe('nothing_to_repeat');
  });
  it('copies the last SIGNED prescription into a new draft: unsigned drafts do not count', async () => {
    const first = await call('docA', 'POST', `/staff/patients/${patient}/prescriptions`, {
      text: 'tab paracetamol 500 mg twice a day for 3 days\nadvice: rest and fluids',
    });
    // an unsigned draft is not "last time"
    expect(
      (await call('docA', 'POST', `/staff/patients/${patient}/prescriptions/repeat`, {}))
        .statusCode,
    ).toBe(404);
    const signed = await call('docA', 'POST', `/staff/issued/${first.json().documentId}/sign`, {
      password: PW,
    });
    expect(signed.statusCode).toBe(200);
    const rep = await call('docA', 'POST', `/staff/patients/${patient}/prescriptions/repeat`, {});
    expect(rep.statusCode).toBe(200);
    expect(rep.json().copiedFrom).toBe(signed.json().number);
    expect(rep.json().items.map((i: any) => i.drug)).toEqual(['paracetamol']);
    const docs = (await call('docA', 'GET', `/staff/patients/${patient}/issued`)).json().documents;
    const copy = docs.find((d: any) => d.id === rep.json().documentId);
    expect(copy.status).toBe('draft'); // reviewed and signed again by the doctor: never automatic
    expect(copy.sent_at).toBeNull();
    expect(copy.content.advice).toBe('rest and fluids');
  });
  it('allergy warnings are recomputed for the patient as they are today', async () => {
    await admin.query(
      "INSERT INTO intake_summaries (clinic_id,patient_id,answers,summary) VALUES ($1,$2,$3,'x')",
      [
        A.clinicId,
        patient,
        JSON.stringify([{ question: 'Do you have any known allergies?', answer: 'paracetamol' }]),
      ],
    );
    const rep = await call('docA', 'POST', `/staff/patients/${patient}/prescriptions/repeat`, {});
    expect(rep.json().warnings.join(' ')).toMatch(/mentions "paracetamol"/);
  });
  it('only the doctor, and only within their own clinic', async () => {
    expect(
      (await call('recA', 'POST', `/staff/patients/${patient}/prescriptions/repeat`, {}))
        .statusCode,
    ).toBe(403);
    expect(
      (await call('docB', 'POST', `/staff/patients/${patient}/prescriptions/repeat`, {}))
        .statusCode,
    ).toBe(404);
  });
});
