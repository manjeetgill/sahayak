import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import {
  addPatient,
  createTestClinic,
  dropTestClinic,
  hashPassword,
  makePool,
  withClinic,
} from '@sahayak/db';
import { EventBus, registerAllTools } from '@sahayak/core';
import { LlmGate } from '@sahayak/agents';
import { buildApp } from '../src/app';

const admin = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
const pool = makePool();
let A: Awaited<ReturnType<typeof createTestClinic>>,
  B: Awaited<ReturnType<typeof createTestClinic>>;
let app: Awaited<ReturnType<typeof buildApp>>;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const h = (k: string) => ({ authorization: `Bearer ${tok[k]}` });
const PW = 'pw-test-1234';

beforeAll(async () => {
  await admin.connect();
  registerAllTools();
  A = await createTestClinic(admin, 'isA');
  B = await createTestClinic(admin, 'isB');
  const pw = await hashPassword(PW);
  for (const [cl, doc, tag] of [
    [A, A.doctorIds[0], 'a'],
    [B, B.doctorIds[0], 'b'],
  ] as const)
    await admin.query(
      "INSERT INTO staff_users (clinic_id,email,password_hash,name,role,doctor_id) VALUES ($1,$2,$3,'D','doctor',$4),($1,$5,$3,'R','receptionist',NULL)",
      [
        cl.clinicId,
        `d${tag}-${cl.slug}@t.in`.toLowerCase(),
        pw,
        doc,
        `r${tag}-${cl.slug}@t.in`.toLowerCase(),
      ],
    );
  app = await buildApp({ pool, bus: new EventBus(''), gate: new LlmGate(null), jwtSecret: 't' });
  for (const [k, cl, p] of [
    ['docA', A, 'da'],
    ['recA', A, 'ra'],
    ['docB', B, 'db'],
  ] as const)
    tok[k] = (
      await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: `${p[0]}${p[1]}-${cl.slug}@t.in`.toLowerCase(), password: PW },
      })
    ).json().token;
  ids.p = await addPatient(admin, A.clinicId, 'Cert Patient', '+919855500001');
  ids.nomsg = await addPatient(admin, A.clinicId, 'No Messages', '+919855500002', {
    whatsapp: false,
  });
  await admin.query('UPDATE patients SET year_of_birth=1990 WHERE id=$1', [ids.p]);
  await admin.query(
    "INSERT INTO intake_summaries (clinic_id,patient_id,answers,summary) VALUES ($1,$2,$3,'x')",
    [
      A.clinicId,
      ids.p,
      JSON.stringify([
        { question: 'Do you have any known allergies?', answer: 'Penicillin and sulfa' },
      ]),
    ],
  );
});
afterAll(async () => {
  await dropTestClinic(admin, A.clinicId);
  await dropTestClinic(admin, B.clinicId);
  await admin.end();
  await pool.end();
  await app.close();
});

const cert = (payload: object, who = 'docA') =>
  app.inject({
    method: 'POST',
    url: `/staff/patients/${ids.p}/certificates`,
    headers: h(who),
    payload,
  });
const sign = (id: string, who = 'docA', extra: object = {}) =>
  app.inject({
    method: 'POST',
    url: `/staff/issued/${id}/sign`,
    headers: h(who),
    payload: { password: PW, ...extra },
  });
const today = new Date().toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

describe('certificates', () => {
  let id = '',
    code = '',
    number = '';
  it('only doctors can draft; the wording is fixed and the doctor fills the details', async () => {
    expect((await cert({ subtype: 'sick_leave', content: {} }, 'recA')).statusCode).toBe(403);
    const r = await cert({
      subtype: 'sick_leave',
      content: { from_date: today, to_date: inDays(2), remarks: 'Rest advised' },
      language: 'both',
    });
    expect(r.statusCode).toBe(200);
    id = r.json().documentId;
  });
  it('cannot sign without a registration number, with a wrong password, or with missing details', async () => {
    expect((await sign(id)).json().error).toBe('registration_required');
    await app.inject({
      method: 'PATCH',
      url: `/staff/doctors/${A.doctorIds[0]}`,
      headers: h('docA'),
      payload: { registrationNo: 'PMC-77777', qualifications: 'MBBS' },
    });
    const bad = await app.inject({
      method: 'POST',
      url: `/staff/issued/${id}/sign`,
      headers: h('docA'),
      payload: { password: 'wrong' },
    });
    expect(bad.json().error).toBe('wrong_password');
    const missing = await cert({ subtype: 'sick_leave', content: {} });
    expect((await sign(missing.json().documentId)).json().error).toBe('incomplete_document');
    const fit = await cert({ subtype: 'fitness', content: { purpose: 'to resume work' } });
    expect((await sign(fit.json().documentId)).json().message).toMatch(
      /Confirm that you found the patient medically fit/,
    );
    const reversed = await cert({
      subtype: 'sick_leave',
      content: { from_date: inDays(3), to_date: today },
    });
    expect((await sign(reversed.json().documentId)).json().message).toMatch(/end date is before/);
  });
  it("a doctor cannot set another doctor's registration number", async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: `/staff/doctors/${A.doctorIds[1]}`,
      headers: h('docA'),
      payload: { registrationNo: 'PMC-1' },
    });
    expect(r.statusCode).toBe(403);
  });
  it("signing issues a number, a verification code and a real PDF with the doctor's registration", async () => {
    const r = await sign(id);
    expect(r.statusCode).toBe(200);
    number = r.json().number;
    code = r.json().verifyCode;
    expect(number).toMatch(/^CERT-\d{4}-000001$/);
    const pdf = await app.inject({ url: `/staff/issued/${id}/pdf`, headers: h('docA') });
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.rawPayload.length).toBeGreaterThan(5000);
    const second = await cert({ subtype: 'attendance', content: {} });
    expect((await sign(second.json().documentId)).json().number).toMatch(/000002$/); // numbering continues, never repeats
  });
  it('a signed document cannot be changed or deleted, even directly in the database by the app', async () => {
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/staff/issued/${id}`,
          headers: h('docA'),
          payload: { content: { remarks: 'sneaky' } },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'DELETE', url: `/staff/issued/${id}`, headers: h('docA') }))
        .statusCode,
    ).toBe(404);
    await expect(
      withClinic(pool, A.clinicId, (db) =>
        db.query("UPDATE issued_documents SET content='{}' WHERE id=$1", [id]),
      ),
    ).rejects.toThrow(/cannot be changed/);
    await expect(
      withClinic(pool, A.clinicId, (db) =>
        db.query('DELETE FROM issued_documents WHERE id=$1', [id]),
      ),
    ).rejects.toThrow(/cannot be deleted/);
    await expect(
      withClinic(pool, A.clinicId, (db) =>
        db.query("UPDATE issued_documents SET status='draft' WHERE id=$1", [id]),
      ),
    ).rejects.toThrow(/cannot be changed/);
  });
  it('anyone can verify a document with its code, and learns nothing medical', async () => {
    const v = (await app.inject({ url: `/public/verify/${code}` })).json();
    expect(v).toMatchObject({
      valid: true,
      kind: 'certificate',
      number,
      doctor: 'Dr. Test One',
      registrationNo: 'PMC-77777',
      patientInitials: 'C. P.',
    });
    expect(JSON.stringify(v)).not.toMatch(/Cert Patient|Rest advised|fever/);
    expect((await app.inject({ url: '/public/verify/AAAAAAAAAAAA' })).json()).toEqual({
      valid: false,
    });
    expect((await app.inject({ url: '/public/verify/short' })).json()).toEqual({ valid: false });
  });
  it('is delivered on WhatsApp as a private link that works a limited number of times', async () => {
    const sent = await app.inject({
      method: 'POST',
      url: `/staff/issued/${id}/send`,
      headers: h('recA'),
    });
    expect(sent.statusCode).toBe(200);
    const msg = (
      await admin.query(
        "SELECT body FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.contact='+919855500001' AND m.direction='out' ORDER BY m.created_at DESC LIMIT 1",
      )
    ).rows[0].body as string;
    expect(msg).toMatch(/medical certificate \(no\. CERT-/);
    expect(msg).not.toMatch(/\/d\/[A-Za-z0-9_-]{20,}/); // the stored chat copy hides the secret link
    const links = (
      await admin.query('SELECT token_hash FROM document_links WHERE document_id=$1', [id])
    ).rows;
    expect(links).toHaveLength(1);
    expect(links[0].token_hash).toMatch(/^[0-9a-f]{64}$/); // only a hash is kept
    // fetch it the way the patient would: build a second link we can see the token of
    const direct = await withClinic(pool, A.clinicId, async (db) => {
      const { createHash, randomBytes } = await import('node:crypto');
      const t = randomBytes(24).toString('base64url');
      await db.query(
        "INSERT INTO document_links (clinic_id,document_id,token_hash,expires_at,max_downloads) VALUES ($1,$2,$3, now() + interval '1 day', 2)",
        [A.clinicId, id, createHash('sha256').update(t).digest('hex')],
      );
      return t;
    });
    const ok = await app.inject({ url: `/d/${direct}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('application/pdf');
    expect(ok.headers['cache-control']).toMatch(/no-store/);
    expect((await app.inject({ url: `/d/${direct}` })).statusCode).toBe(200);
    expect((await app.inject({ url: `/d/${direct}` })).statusCode).toBe(404); // download limit reached
    expect((await app.inject({ url: '/d/not-a-real-token' })).statusCode).toBe(404);
    await admin.query(
      "UPDATE document_links SET expires_at = now() - interval '1 minute' WHERE document_id=$1",
      [id],
    );
  });
  it('is not sent to a patient who has not agreed to messages', async () => {
    const d = await app.inject({
      method: 'POST',
      url: `/staff/patients/${ids.nomsg}/certificates`,
      headers: h('docA'),
      payload: { subtype: 'attendance', content: {} },
    });
    await sign(d.json().documentId);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/staff/issued/${d.json().documentId}/send`,
          headers: h('docA'),
        })
      ).json().error,
    ).toBe('no_consent');
  });
  it('voiding keeps the record but kills the links and the verification', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/staff/issued/${id}/void`,
          headers: h('docA'),
          payload: { reason: 'issued to wrong patient' },
        })
      ).statusCode,
    ).toBe(200);
    expect((await app.inject({ url: `/public/verify/${code}` })).json()).toMatchObject({
      valid: false,
      status: 'void',
    });
    expect(
      (await admin.query('SELECT count(*)::int n FROM document_links WHERE document_id=$1', [id]))
        .rows[0].n,
    ).toBe(0);
    expect(
      (await app.inject({ method: 'POST', url: `/staff/issued/${id}/send`, headers: h('docA') }))
        .statusCode,
    ).toBe(404);
  });
  it('another clinic cannot see, sign or download any of it', async () => {
    const d = await cert({ subtype: 'attendance', content: {} });
    expect((await sign(d.json().documentId, 'docB')).statusCode).toBe(404);
    expect(
      (await app.inject({ url: `/staff/issued/${id}/pdf`, headers: h('docB') })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ url: `/staff/patients/${ids.p}/issued`, headers: h('docB') })).json()
        .documents,
    ).toEqual([]);
  });
});

describe('prescriptions', () => {
  let id = '';
  it("are drafted from the doctor's own words, copying each medicine exactly", async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/staff/patients/${ids.p}/prescriptions`,
      headers: h('docA'),
      payload: {
        text: 'tab paracetamol 500 mg twice a day for 3 days\ntab amoxicillin 500 mg 1-0-1 for 5 days\nadvice: rest and fluids',
      },
    });
    expect(r.statusCode).toBe(200);
    id = r.json().documentId;
    expect(r.json().items.map((i: any) => i.drug)).toEqual(['paracetamol', 'amoxicillin']);
    expect(r.json().incomplete).toEqual([]);
  });
  it('warns when a medicine may clash with an allergy the patient listed, and signing needs an explicit confirmation', async () => {
    const list = (
      await app.inject({ url: `/staff/patients/${ids.p}/issued`, headers: h('docA') })
    ).json().documents;
    const rx = list.find((d: any) => d.id === id);
    expect(rx.content.allergies_noted).toBe('Penicillin and sulfa');
    expect(rx.warnings).toEqual([]); // "amoxicillin" is not literally in the allergy text: we never claim cross-reactions
    const d2 = await app.inject({
      method: 'POST',
      url: `/staff/patients/${ids.p}/prescriptions`,
      headers: h('docA'),
      payload: { text: 'tab penicillin 250 mg qid for 5 days' },
    });
    expect(d2.json().warnings[0]).toMatch(/mentions "penicillin"/);
    expect((await sign(d2.json().documentId)).json().error).toBe('warnings_not_acknowledged');
    expect(
      (await sign(d2.json().documentId, 'docA', { acknowledgeWarnings: true })).statusCode,
    ).toBe(200);
  });
  it('cannot be signed with a missing frequency or duration; the doctor fixes it first', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/staff/patients/${ids.p}/prescriptions`,
      headers: h('docA'),
      payload: { text: 'tab drugx 10 mg' },
    });
    expect(r.json().incomplete.join(' ')).toMatch(/how often and duration not found/);
    const s = await sign(r.json().documentId);
    expect(s.json().error).toBe('incomplete_document');
    const fix = await app.inject({
      method: 'PATCH',
      url: `/staff/issued/${r.json().documentId}`,
      headers: h('docA'),
      payload: {
        content: {
          items: [
            { drug: 'drugx', strength: '10 mg', frequency: 'once a day', duration: '5 days' },
          ],
        },
      },
    });
    expect(fix.statusCode).toBe(200);
    expect((await sign(r.json().documentId)).json().number).toMatch(/^RX-\d{4}-000002$/);
  });
  it('nothing readable is refused, and no AI is involved in what goes on a prescription', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/staff/patients/${ids.p}/prescriptions`,
          headers: h('docA'),
          payload: { text: ' ; ' },
        })
      ).statusCode,
    ).toBe(400);
    const { readFileSync } = await import('node:fs');
    const src =
      readFileSync(new URL('../../../packages/core/src/tools/issued.ts', import.meta.url), 'utf8') +
      readFileSync(new URL('../../../packages/core/src/prescription.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/gate|LlmProvider|\.chat\(/);
  });
  it('clinical text stays out of the audit log', async () => {
    const all = JSON.stringify(
      (
        await admin.query('SELECT input, output FROM agent_actions WHERE clinic_id=$1', [
          A.clinicId,
        ])
      ).rows,
    );
    const m = all.match(/paracetamol|amoxicillin|Rest advised|\/d\/[A-Za-z0-9_-]{20}/);
    expect(m && m[0]).toBeNull();
  });
});

describe('erasure with issued documents', () => {
  it('keeps signed certificates and prescriptions during the legal period (partial erasure)', async () => {
    const rt = { pool, bus: new EventBus('') };
    const { callTool } = await import('@sahayak/core');
    const rec = {
      clinicId: A.clinicId,
      actor: {
        kind: 'staff' as const,
        role: 'receptionist' as const,
        userId: (
          await admin.query(
            "SELECT id FROM staff_users WHERE clinic_id=$1 AND role='receptionist'",
            [A.clinicId],
          )
        ).rows[0].id,
      },
    };
    // issued documents count as clinical records: partial erasure keeps them
    const out = await callTool(rt, rec, 'erase_patient_data', { patientId: ids.p });
    expect(out.partial).toBe(true);
    expect(
      (
        await admin.query(
          "SELECT count(*)::int n FROM issued_documents WHERE patient_id=$1 AND status IN ('signed','void')",
          [ids.p],
        )
      ).rows[0].n,
    ).toBeGreaterThan(0);
  });
});
