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
import { EventBus, callTool, registerAllTools } from '@sahayak/core';
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
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const PDF = Buffer.from('%PDF-1.4\n%fake\n');
const b64 = (b: Buffer) => b.toString('base64');

beforeAll(async () => {
  await admin.connect();
  registerAllTools();
  A = await createTestClinic(admin, 'recA');
  B = await createTestClinic(admin, 'recB');
  const pw = await hashPassword('pw-test-1234');
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
        payload: {
          email: `${p[0]}${p[1]}-${cl.slug}@t.in`.toLowerCase(),
          password: 'pw-test-1234',
        },
      })
    ).json().token;
  ids.pa = await addPatient(admin, A.clinicId, 'Record Patient', '+919844400001');
  ids.pb = await addPatient(admin, B.clinicId, 'Other Clinic Patient', '+919844400002');
});
afterAll(async () => {
  await dropTestClinic(admin, A.clinicId);
  await dropTestClinic(admin, B.clinicId);
  await admin.end();
  await pool.end();
  await app.close();
});

const draft = (transcript: string, who = 'docA', patientId = ids.pa) =>
  app.inject({
    method: 'POST',
    url: '/staff/notes/draft',
    headers: h(who),
    payload: { patientId, transcript, source: 'typed' },
  });

describe('visit notes', () => {
  let noteId = '';
  it('only doctors can write or read clinical notes', async () => {
    expect((await draft('Complaint: cough', 'recA')).statusCode).toBe(403);
    expect(
      (await app.inject({ url: `/staff/patients/${ids.pa}/record`, headers: h('recA') }))
        .statusCode,
    ).toBe(403);
  });
  it('the scribe drafts a structured note from what the doctor said; it is a draft until signed', async () => {
    const r = await draft(
      'Complaint: fever 3 days. Diagnosis: viral fever. Plan: rest and fluids. Follow up: 1 week',
    );
    expect(r.statusCode).toBe(200);
    noteId = r.json().noteId;
    expect(r.json().note).toMatchObject({ complaint: 'fever 3 days', diagnosis: 'viral fever' });
    const rec = (
      await app.inject({ url: `/staff/patients/${ids.pa}/record`, headers: h('docA') })
    ).json();
    expect(rec.notes[0]).toMatchObject({ id: noteId, status: 'draft' });
  });
  it('the doctor can edit the draft, then sign; a signed note is locked', async () => {
    const ed = await app.inject({
      method: 'PATCH',
      url: `/staff/notes/${noteId}`,
      headers: h('docA'),
      payload: {
        note: {
          complaint: 'fever 3 days',
          diagnosis: 'viral fever (edited)',
          plan: 'rest and fluids',
        },
      },
    });
    expect(ed.statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'POST', url: `/staff/notes/${noteId}/sign`, headers: h('docA') }))
        .statusCode,
    ).toBe(200);
    const again = await app.inject({
      method: 'PATCH',
      url: `/staff/notes/${noteId}`,
      headers: h('docA'),
      payload: { note: { diagnosis: 'sneaky change' } },
    });
    expect(again.statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'DELETE', url: `/staff/notes/${noteId}`, headers: h('docA') }))
        .statusCode,
    ).toBe(404);
  });
  it('even direct database writes by the application cannot change or delete a signed note', async () => {
    await expect(
      withClinic(pool, A.clinicId, (db) =>
        db.query("UPDATE visit_notes SET note='{}' WHERE id=$1", [noteId]),
      ),
    ).rejects.toThrow(/signed visit notes cannot be changed/);
    await expect(
      withClinic(pool, A.clinicId, (db) =>
        db.query('DELETE FROM visit_notes WHERE id=$1', [noteId]),
      ),
    ).rejects.toThrow(/signed visit notes cannot be changed/);
  });
  it('corrections are amendments: a new draft linked to the original, which stays on record', async () => {
    const am = await app.inject({
      method: 'POST',
      url: `/staff/notes/${noteId}/amend`,
      headers: h('docA'),
      payload: { reason: 'wrong diagnosis' },
    });
    expect(am.statusCode).toBe(200);
    const rec = (
      await app.inject({ url: `/staff/patients/${ids.pa}/record`, headers: h('docA') })
    ).json();
    const orig = rec.notes.find((n: any) => n.id === noteId);
    const next = rec.notes.find((n: any) => n.id === am.json().noteId);
    expect(orig.status).toBe('signed');
    expect(next).toMatchObject({
      status: 'draft',
      amends_note_id: noteId,
      amend_reason: 'wrong diagnosis',
    });
  });
  it('cannot sign an empty note', async () => {
    const e = await app.inject({
      method: 'POST',
      url: '/staff/notes/draft',
      headers: h('docA'),
      payload: { patientId: ids.pa, transcript: 'x' },
    });
    await app.inject({
      method: 'PATCH',
      url: `/staff/notes/${e.json().noteId}`,
      headers: h('docA'),
      payload: { note: {} },
    });
    const s = await app.inject({
      method: 'POST',
      url: `/staff/notes/${e.json().noteId}/sign`,
      headers: h('docA'),
    });
    expect(s.json().error).toBe('empty_note');
  });
  it('another clinic cannot see or touch this patient or their notes', async () => {
    expect(
      (await app.inject({ url: `/staff/patients/${ids.pa}/record`, headers: h('docB') }))
        .statusCode,
    ).toBe(404);
    expect((await draft('Complaint: x', 'docB', ids.pa)).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/staff/notes/${noteId}/amend`,
          headers: h('docB'),
          payload: { reason: 'abc' },
        })
      ).statusCode,
    ).toBe(404);
  });
  it('clinical text never appears in the audit log, but every access is logged', async () => {
    const all = JSON.stringify(
      (
        await admin.query('SELECT input, output FROM agent_actions WHERE clinic_id=$1', [
          A.clinicId,
        ])
      ).rows,
    );
    expect(all).not.toMatch(/viral fever|fever 3 days|rest and fluids/);
    const opened = (
      await admin.query(
        "SELECT count(*)::int n FROM agent_actions WHERE clinic_id=$1 AND tool='get_patient_record'",
        [A.clinicId],
      )
    ).rows[0].n;
    expect(opened).toBeGreaterThanOrEqual(2);
  });
  it('tags and search', async () => {
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/staff/patients/${ids.pa}/tags`,
          headers: h('docA'),
          payload: { tags: ['Diabetes', 'diabetes', 'bp'] },
        })
      ).statusCode,
    ).toBe(200);
    const found = (
      await app.inject({ url: '/staff/patients/search?q=Record', headers: h('docA') })
    ).json();
    expect(found[0]).toMatchObject({ name: 'Record Patient', tags: ['diabetes', 'bp'] });
    expect(
      (await app.inject({ url: '/staff/patients/search?q=Record', headers: h('docB') })).json(),
    ).toEqual([]);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/staff/patients/${ids.pa}/tags`,
          headers: h('docA'),
          payload: { tags: ['bad tag!!'] },
        })
      ).statusCode,
    ).toBe(400);
  });
});

describe('patient documents', () => {
  let docId = '';
  it('staff can upload a scan; the type is judged from the contents, not the name', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: `/staff/patients/${ids.pa}/documents`,
      headers: h('recA'),
      payload: { filename: 'blood-test.pdf', base64: b64(PDF), kind: 'report' },
    });
    expect(ok.statusCode).toBe(200);
    docId = ok.json().documentId;
    expect(ok.json().mime).toBe('application/pdf');
    const disguised = await app.inject({
      method: 'POST',
      url: `/staff/patients/${ids.pa}/documents`,
      headers: h('recA'),
      payload: {
        filename: 'photo.jpg',
        base64: b64(Buffer.from('<html><script>alert(1)</script></html>')),
      },
    });
    expect(disguised.json().error).toBe('unsupported_file');
    const huge = await app.inject({
      method: 'POST',
      url: `/staff/patients/${ids.pa}/documents`,
      headers: h('recA'),
      payload: {
        filename: 'big.pdf',
        base64: b64(Buffer.concat([PDF, Buffer.alloc(8.1 * 1024 * 1024)])),
      },
    });
    expect(huge.json().error).toBe('file_too_large');
  });
  it('only a doctor can open it, it is served safely, and opening is audited', async () => {
    expect(
      (await app.inject({ url: `/staff/documents/${docId}`, headers: h('recA') })).statusCode,
    ).toBe(403);
    const r = await app.inject({ url: `/staff/documents/${docId}`, headers: h('docA') });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-security-policy']).toMatch(/sandbox/);
    expect(r.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(
      (await app.inject({ url: `/staff/documents/${docId}`, headers: h('docB') })).statusCode,
    ).toBe(404);
    expect(
      (await admin.query("SELECT 1 FROM agent_actions WHERE tool='get_patient_document'")).rowCount,
    ).toBeGreaterThan(0);
    expect(
      (await admin.query('SELECT status FROM patient_documents WHERE id=$1', [docId])).rows[0]
        .status,
    ).toBe('reviewed');
  });
});

describe('reports sent by the patient on WhatsApp', () => {
  const sim = (payload: object) =>
    app.inject({ method: 'POST', url: `/sim/${A.slug}/media`, payload });
  it("a known patient's photo is attached to their record and the team is told", async () => {
    const r = await sim({
      from: '9844400001',
      filename: 'xray.png',
      base64: b64(PNG),
      caption: 'my knee x-ray',
    });
    expect(r.json().replies[0]).toMatch(/Received your photo/);
    const docs = (
      await admin.query(
        "SELECT filename, mime, uploaded_via, status FROM patient_documents WHERE patient_id=$1 AND filename='xray.png'",
        [ids.pa],
      )
    ).rows;
    expect(docs[0]).toEqual({
      filename: 'xray.png',
      mime: 'image/png',
      uploaded_via: 'whatsapp',
      status: 'new',
    });
    const flags = (await app.inject({ url: '/staff/flags', headers: h('recA') })).json();
    expect(flags.some((f: any) => /Patient sent a photo/.test(f.summary))).toBe(true);
  });
  it('an unknown number is not accepted; executable or disguised files are refused', async () => {
    expect(
      (await sim({ from: '9844400099', filename: 'a.png', base64: b64(PNG) })).json().replies[0],
    ).toMatch(/can't attach files/);
    expect(
      (await admin.query("SELECT 1 FROM patient_documents WHERE filename='a.png'")).rowCount,
    ).toBe(0);
    const r = await sim({
      from: '9844400001',
      filename: 'report.pdf',
      base64: b64(Buffer.from('MZ\x90\x00 this is an exe')),
    });
    expect(r.json().replies[0]).toMatch(/only accept photos/);
  });
  it('a caption describing an emergency still raises the alert', async () => {
    const r = await sim({
      from: '9844400001',
      filename: 'x.png',
      base64: b64(PNG),
      caption: 'I have chest pain',
    });
    expect(r.json().redFlag).toBe(true);
  });
});

describe('erasure with signed clinical records', () => {
  const rt = { pool, bus: new EventBus('') };
  it('removes chats and contact data now but keeps signed records until the retention date, then purges', async () => {
    const pid = await addPatient(admin, A.clinicId, 'Keep Records', '+919844400010');
    const doc = {
      clinicId: A.clinicId,
      actor: {
        kind: 'staff' as const,
        role: 'doctor' as const,
        userId: (
          await admin.query("SELECT id FROM staff_users WHERE clinic_id=$1 AND role='doctor'", [
            A.clinicId,
          ])
        ).rows[0].id,
        doctorId: A.doctorIds[0],
      },
    };
    const n = await callTool(rt, doc, 'save_visit_note_draft', {
      patientId: pid,
      transcript: 'Complaint: back pain',
      note: { complaint: 'back pain' },
      source: 'typed',
    });
    await callTool(rt, doc, 'sign_visit_note', { noteId: n.noteId });
    await app.inject({
      method: 'POST',
      url: `/sim/${A.slug}/message`,
      payload: { from: '9844400010', text: 'hello' },
    });
    const rec = {
      clinicId: A.clinicId,
      actor: { kind: 'staff' as const, role: 'receptionist' as const, userId: doc.actor.userId },
    };
    const out = await callTool(rt, rec, 'erase_patient_data', { patientId: pid });
    expect(out.partial).toBe(true);
    expect(out.holdUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(
      (await admin.query('SELECT 1 FROM conversations WHERE contact=$1', ['+919844400010']))
        .rowCount,
    ).toBe(0);
    expect(
      (
        await admin.query(
          'SELECT name, clinical_hold_until IS NOT NULL AS held FROM patients WHERE id=$1',
          [pid],
        )
      ).rows[0],
    ).toEqual({ name: 'Keep Records', held: true });
    expect(
      (await admin.query('SELECT count(*)::int n FROM visit_notes WHERE patient_id=$1', [pid]))
        .rows[0].n,
    ).toBe(1);
    expect(
      (
        await admin.query(
          'SELECT count(*)::int n FROM consents WHERE patient_id=$1 AND withdrawn_at IS NULL',
          [pid],
        )
      ).rows[0].n,
    ).toBe(0);
    // the retention date passes: the nightly job finishes the erasure
    await admin.query('UPDATE patients SET clinical_hold_until = now()::date - 1 WHERE id=$1', [
      pid,
    ]);
    const sweep = await callTool(
      rt,
      { clinicId: A.clinicId, actor: { kind: 'system' } },
      'apply_retention',
      {},
    );
    expect(sweep.patientsErased).toBeGreaterThanOrEqual(1);
    expect((await admin.query('SELECT name FROM patients WHERE id=$1', [pid])).rows[0].name).toBe(
      'Erased patient',
    );
    expect(
      (await admin.query('SELECT count(*)::int n FROM visit_notes WHERE patient_id=$1', [pid]))
        .rows[0].n,
    ).toBe(0);
  });
  it('a patient with no clinical records is erased immediately', async () => {
    const pid = await addPatient(admin, A.clinicId, 'No Records', '+919844400011');
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
    expect((await callTool(rt, rec, 'erase_patient_data', { patientId: pid })).partial).toBe(false);
    expect((await admin.query('SELECT name FROM patients WHERE id=$1', [pid])).rows[0].name).toBe(
      'Erased patient',
    );
  });
  it('the data export includes signed notes and document metadata', async () => {
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
    const out = await callTool(rt, rec, 'export_patient_data', { patientId: ids.pa });
    expect(out.visitNotes.length).toBeGreaterThanOrEqual(1);
    expect(out.documents.map((d: any) => d.filename)).toContain('blood-test.pdf');
    expect(out.documents[0].data).toBeUndefined();
  });
});
