import { beforeAll, afterAll, it, expect } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { createTestClinic, dropTestClinic, addPatient, makePool } from '@sahayak/db';
import { callTool, EventBus, registerAllTools, type ToolContext } from '../src';
import { parseReportRows, medicationWarnings } from '../src/tools/clinical-workbench';
const admin = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
const pool = makePool();
const rt = { pool, bus: new EventBus('') };
let clinic: Awaited<ReturnType<typeof createTestClinic>>,
  other: typeof clinic,
  ctx: ToolContext,
  patient: string,
  foreign: string,
  doctor: string,
  doc: string,
  note: string;
const run = (name: string, input: unknown, context = ctx): Promise<any> =>
  callTool(rt, context, name, input);
beforeAll(async () => {
  await admin.connect();
  registerAllTools();
  clinic = await createTestClinic(admin, 'workbench');
  other = await createTestClinic(admin, 'workbench-other');
  doctor = (
    await admin.query(
      "INSERT INTO staff_users(clinic_id,email,password_hash,name,role,doctor_id) VALUES ($1,$2,'unused','Workbench Doctor','doctor',$3) RETURNING id",
      [clinic.clinicId, `${clinic.slug}@test.invalid`, clinic.doctorIds[0]],
    )
  ).rows[0].id;
  ctx = {
    clinicId: clinic.clinicId,
    actor: { kind: 'staff', role: 'doctor', userId: doctor, doctorId: clinic.doctorIds[0] },
  };
  patient = await addPatient(admin, clinic.clinicId, 'Private Workbench Patient', '+199900003333');
  foreign = await addPatient(admin, other.clinicId, 'Other Patient', '+199900003334');
  doc = (
    await admin.query(
      "INSERT INTO patient_documents(clinic_id,patient_id,uploaded_via,filename,mime,size_bytes,data) VALUES ($1,$2,'staff','private.pdf','application/pdf',1,'x') RETURNING id",
      [clinic.clinicId, patient],
    )
  ).rows[0].id;
  note = (
    await admin.query(
      "INSERT INTO visit_notes(clinic_id,patient_id,doctor_id,transcript,note,status,signed_at) VALUES ($1,$2,$3,'private original',$4,'signed',now()) RETURNING id",
      [
        clinic.clinicId,
        patient,
        clinic.doctorIds[0],
        { plan: 'Review the report.', instructions: 'Bring the original report.' },
      ],
    )
  ).rows[0].id;
});
afterAll(async () => {
  if (clinic) await dropTestClinic(admin, clinic.clinicId);
  if (other) await dropTestClinic(admin, other.clinicId);
  await admin.end();
  await pool.end();
});
it('requires doctor access and same-patient source records', async () => {
  await expect(
    run(
      'get_clinical_workspace',
      { patientId: patient },
      { ...ctx, actor: { kind: 'staff', role: 'receptionist', userId: doctor } },
    ),
  ).rejects.toThrow();
  await expect(run('get_clinical_workspace', { patientId: foreign })).rejects.toThrow(
    'Patient not found',
  );
  await expect(
    run('add_clinical_entry', {
      patientId: foreign,
      occurredOn: '2026-10-01',
      verified: true,
      data: { kind: 'diagnosis', name: 'Private' },
    }),
  ).rejects.toThrow();
  const second = await addPatient(admin, clinic.clinicId, 'Second test patient', '+199900003335');
  await expect(
    run('add_clinical_entry', {
      patientId: second,
      documentId: doc,
      occurredOn: '2026-10-01',
      verified: false,
      data: {
        kind: 'lab',
        name: 'Example',
        value: 5,
        unit: 'units',
        sourceText: 'Example 5 units',
      },
    }),
  ).rejects.toThrow('belonging to this patient');
});
it('imports numeric rows unverified, preserves their source, and rejects ambiguous values', async () => {
  expect(() => parseReportRows('Example\t<5\tunits')).toThrow('plain numeric');
  expect(() => parseReportRows('Example\t5\tunits\t9\t3')).toThrow();
  await run('import_report_rows', {
    patientId: patient,
    documentId: doc,
    occurredOn: '2026-10-01',
    source: 'Example\t5\tunits\t1\t4',
  });
  let data = await run('get_clinical_workspace', { patientId: patient });
  const e = data.entries.find((e: any) => e.kind === 'lab');
  expect(e.verified_at).toBeNull();
  expect(e.data.sourceText).toBe('Example\t5\tunits\t1\t4');
  await run('update_clinical_entry', { id: e.id, verify: true });
  data = await run('get_clinical_workspace', { patientId: patient });
  expect(data.entries.find((x: any) => x.id === e.id).verified_by).toBe(doctor);
});
it('checks only verified active medicine facts and exact allergy matches', async () => {
  const entry = (id: string, kind: string, data: any, verified_at: any = '2026-10-01') => ({
    id,
    kind,
    data,
    status: 'active',
    verified_at,
  });
  const result = medicationWarnings([
    entry('a', 'medication', { ingredient: ' Example ' }),
    entry('b', 'medication', { ingredient: 'example' }),
    entry('c', 'allergy', { substance: 'EXAMPLE' }),
    entry('d', 'allergy', { substance: 'other' }),
  ]);
  expect(result.warnings).toHaveLength(3);
  expect(result.limitations).toContain('does not check interactions');
  expect(
    medicationWarnings([
      entry('a', 'medication', { ingredient: 'example' }, null),
      entry('b', 'allergy', { substance: 'example' }),
    ]).warnings,
  ).toHaveLength(0);
});
it('prepares instructions only from a signed source and freezes approval', async () => {
  const draft = await run('draft_patient_instructions', {
    patientId: patient,
    noteId: note,
    language: 'hi',
  });
  const data = await run('get_clinical_workspace', { patientId: patient });
  expect(data.instructions[0].body).toContain('Bring the original report.');
  await run('save_patient_instructions', {
    id: draft.id,
    body: 'Doctor-approved exact text',
    approve: true,
  });
  await expect(
    run('save_patient_instructions', { id: draft.id, body: 'changed', approve: false }),
  ).rejects.toThrow('draft');
  await expect(
    run('draft_patient_instructions', { patientId: foreign, noteId: note }),
  ).rejects.toThrow();
});
it('enforces plan approval, handles concerning replies, and preserves response history', async () => {
  const plan = await run('create_care_plan', {
    patientId: patient,
    title: 'Test follow-up',
    assignedTo: doctor,
    steps: [
      {
        title: 'Check response',
        message: 'Please contact the clinic.',
        dueAt: new Date(Date.now() - 1000).toISOString(),
      },
    ],
  });
  let data = await run('get_clinical_workspace', { patientId: patient });
  const step = data.steps.find((s: any) => s.plan_id === plan.id);
  await expect(run('update_care_step', { id: step.id, status: 'contacted' })).rejects.toThrow(
    'Approve',
  );
  await run('change_care_plan', { id: plan.id, status: 'active' });
  await run('update_care_step', { id: step.id, status: 'contacted' });
  const result = await run('update_care_step', {
    id: step.id,
    status: 'completed',
    response: 'I have severe chest pain',
  });
  expect(result.urgent).toBe(true);
  data = await run('get_clinical_workspace', { patientId: patient });
  expect(data.steps.find((s: any) => s.id === step.id).status).toBe('needs_review');
  expect(data.stepHistory.some((h: any) => h.response === 'I have severe chest pain')).toBe(true);
  await expect(run('change_care_plan', { id: plan.id, status: 'completed' })).rejects.toThrow(
    'Complete',
  );
  await expect(
    run('update_care_step', { id: step.id, status: 'completed', response: 'Reviewed by doctor' }),
  ).rejects.toThrow('urgent alert');
  const inbox = await run('get_doctor_inbox', {});
  const alert = inbox.items.find((i: any) => i.priority === 0);
  await expect(
    run('update_inbox_review', {
      key: alert.key,
      action: 'later',
      until: new Date(Date.now() + 86400000).toISOString(),
    }),
  ).rejects.toThrow('Urgent');
  await run('update_inbox_review', { key: alert.key, action: 'acknowledge' });
  await run('update_inbox_review', {
    key: alert.key,
    action: 'handled',
    reason: 'Doctor reviewed and arranged care',
  });
  await run('update_care_step', {
    id: step.id,
    status: 'completed',
    response: 'Reviewed by doctor and next steps recorded',
  });
  await run('change_care_plan', { id: plan.id, status: 'completed' });
});
it('assigns and defers nonurgent work without changing clinical completion', async () => {
  const inbox = await run('get_doctor_inbox', {});
  const item = inbox.items.find((i: any) => i.kind === 'report');
  await run('update_inbox_review', { key: item.key, action: 'assign', assignedTo: doctor });
  await run('update_inbox_review', {
    key: item.key,
    action: 'later',
    until: new Date(Date.now() + 3600000).toISOString(),
  });
  expect(
    (await run('get_doctor_inbox', { view: 'later' })).items.some((i: any) => i.key === item.key),
  ).toBe(true);
  expect((await run('get_doctor_inbox', {})).items.some((i: any) => i.key === item.key)).toBe(
    false,
  );
  await expect(
    run('update_inbox_review', { key: item.key, action: 'handled', reason: 'Reviewed' }),
  ).rejects.toThrow('original record');
  await run('update_inbox_review', { key: item.key, action: 'restore' });
  expect(
    (await run('get_doctor_inbox', { view: 'mine' })).items.some((i: any) => i.key === item.key),
  ).toBe(true);
});
it('records payments idempotently and prevents overpayment', async () => {
  const c = await run('add_clinic_charge', {
    patientId: patient,
    description: 'Consultation',
    amountPaise: 10000,
  });
  const input = { chargeId: c.id, requestId: randomUUID(), amountPaise: 7000, method: 'cash' };
  await run('record_clinic_payment', input);
  await run('record_clinic_payment', input);
  await expect(
    run('record_clinic_payment', { ...input, requestId: randomUUID(), amountPaise: 4000 }),
  ).rejects.toThrow('exceeds');
  const data = await run('get_clinical_workspace', { patientId: patient });
  expect(data.charges.find((c: any) => c.id === input.chargeId).paid).toBe(7000);
  const summary = await run('get_practice_overview', {});
  expect(Number(summary.finances.collected)).toBe(7000);
  expect(Number(summary.finances.outstanding)).toBe(3000);
});
it('exports new records and omits private text from tool audit logs', async () => {
  const exported = await run('export_patient_data', { patientId: patient });
  expect(JSON.stringify(exported)).toContain('Doctor-approved exact text');
  const audit = (
    await admin.query(
      "SELECT input,output FROM agent_actions WHERE clinic_id=$1 AND tool IN ('get_clinical_workspace','add_clinical_entry','save_patient_instructions','update_care_step','update_inbox_review')",
      [clinic.clinicId],
    )
  ).rows;
  expect(JSON.stringify(audit)).not.toContain('severe chest pain');
  expect(JSON.stringify(audit)).not.toContain('Doctor-approved exact text');
  expect(JSON.stringify(audit)).not.toContain('Doctor reviewed and arranged care');
});
it('corrects mistaken payments without deletion, and cancels only unpaid charges', async () => {
  let data = await run('get_clinical_workspace', { patientId: patient });
  const c = data.charges[0];
  const p = data.payments[0];
  await expect(
    run('correct_clinic_billing', { chargeId: c.id, reason: 'entered_in_error' }),
  ).rejects.toThrow('payment entries');
  await run('correct_clinic_billing', {
    chargeId: c.id,
    paymentId: p.id,
    reason: 'incorrect_amount',
  });
  await run('correct_clinic_billing', {
    chargeId: c.id,
    paymentId: p.id,
    reason: 'incorrect_amount',
  });
  data = await run('get_clinical_workspace', { patientId: patient });
  expect(data.payments[0].voided_at).not.toBeNull();
  expect(data.charges[0].paid).toBe(0);
  await expect(
    run('record_clinic_payment', {
      chargeId: c.id,
      requestId: p.request_id,
      amountPaise: p.amount_paise,
      method: p.method,
    }),
  ).rejects.toThrow('corrected');
  await run('correct_clinic_billing', { chargeId: c.id, reason: 'entered_in_error' });
  const overview = await run('get_practice_overview', {});
  expect(Number(overview.finances.collected)).toBe(0);
  expect(Number(overview.finances.outstanding)).toBe(0);
});
it('reviews and archives clinic references and preserves date-only values', async () => {
  const form = {
    title: 'Synthetic reference',
    url: 'https://pubmed.ncbi.nlm.nih.gov/',
    publishedOn: '2026-10-01',
    reviewDue: '2027-01-01',
    notes: 'General topic only',
  };
  const saved = await run('save_medical_reference', form);
  await run('save_medical_reference', { ...form, id: saved.id, notes: 'Updated review' });
  const refs = await run('list_medical_references', {});
  expect(refs.references).toHaveLength(1);
  expect(refs.references[0]).toMatchObject({ published_on: '2026-10-01', notes: 'Updated review' });
  await run('archive_medical_reference', { id: saved.id });
  expect((await run('list_medical_references', {})).references).toHaveLength(0);
});
it('versions reusable plans and creates one patient draft per request, with editable wording before approval', async () => {
  const form = {
    title: 'Reusable report review',
    steps: [{ title: 'Bring report', message: 'Please bring the original report.', afterDays: 2 }],
  };
  const t = await run('save_care_template', form);
  const apply = {
    id: t.id,
    patientId: patient,
    assignedTo: doctor,
    startAt: '2026-10-05T10:00:00.000Z',
    requestId: randomUUID(),
  };
  await expect(run('apply_care_template', apply)).rejects.toThrow('approved');
  await run('review_care_template', { id: t.id, action: 'approve' });
  const first = await run('apply_care_template', apply),
    again = await run('apply_care_template', apply);
  expect(again.id).toBe(first.id);
  let work = await run('get_clinical_workspace', { patientId: patient });
  const step = work.steps.find((s: any) => s.plan_id === first.id);
  expect(new Date(step.due_at).toISOString()).toBe('2026-10-07T10:00:00.000Z');
  await run('edit_draft_care_step', {
    id: step.id,
    title: step.title,
    message: 'Patient-specific review wording',
    dueAt: '2026-10-08T10:00:00.000Z',
  });
  await run('change_care_plan', { id: first.id, status: 'active' });
  await expect(
    run('edit_draft_care_step', {
      id: step.id,
      title: step.title,
      message: 'changed',
      dueAt: new Date(step.due_at).toISOString(),
    }),
  ).rejects.toThrow('draft');
  const newer = await run('save_care_template', {
    ...form,
    previousId: t.id,
    title: 'Revised report review',
  });
  const library = await run('list_care_templates', {});
  expect(library.templates.find((x: any) => x.id === newer.id).version).toBe(2);
  await run('review_care_template', { id: t.id, action: 'archive' });
  await expect(run('apply_care_template', { ...apply, requestId: randomUUID() })).rejects.toThrow(
    'approved',
  );
  await run('update_care_step', { id: step.id, status: 'contacted' });
  await expect(run('update_care_step', { id: step.id, status: 'no_response' })).rejects.toThrow(
    'not overdue',
  );
  await admin.query(
    "UPDATE care_plan_steps SET response_due_at=now()-interval '1 hour' WHERE id=$1",
    [step.id],
  );
  expect((await run('get_daily_care_brief', {})).no_reply).toBe(1);
  await run('update_care_step', { id: step.id, status: 'no_response' });
  work = await run('get_clinical_workspace', { patientId: patient });
  expect(work.steps.find((s: any) => s.id === step.id).status).toBe('no_response');
});
it('requires original-result verification and explicit doctor review to clear outside-range work', async () => {
  const data = await run('get_clinical_workspace', { patientId: patient }),
    lab = data.entries.find((e: any) => e.kind === 'lab');
  expect(
    (await run('get_doctor_inbox', { category: 'result' })).items.some(
      (i: any) => i.key === 'result:' + lab.id,
    ),
  ).toBe(true);
  await run('review_clinical_result', {
    id: lab.id,
    note: 'Reviewed with original report; follow-up recorded.',
  });
  expect((await run('get_doctor_inbox', { category: 'result' })).total).toBe(0);
  await expect(run('review_clinical_result', { id: lab.id, note: 'Rewrite' })).rejects.toThrow(
    'already',
  );
  const facts = await run('search_patient_record', {
    patientId: patient,
    question: 'show test results outside range',
  });
  expect(facts.records.some((r: any) => r.id === lab.id)).toBe(true);
  expect(facts).not.toHaveProperty('diagnosis');
  await expect(run('search_patient_record', { patientId: foreign })).rejects.toThrow('not found');
});
it('tracks actual insurer correspondence and rejects premature decisions', async () => {
  const c = await run('create_insurance_case', {
    patientId: patient,
    title: 'Synthetic pre-authorization',
    assignedTo: doctor,
    dueAt: '2026-10-01T00:00:00.000Z',
    documentId: doc,
  });
  await expect(
    run('update_insurance_case', { id: c.id, status: 'approved', note: 'Too early' }),
  ).rejects.toThrow('sequence');
  await run('update_insurance_case', {
    id: c.id,
    status: 'submitted',
    note: 'Submitted through the clinic process',
  });
  await run('update_insurance_case', {
    id: c.id,
    status: 'more_information',
    note: 'Insurer requested original report',
  });
  expect((await run('get_doctor_inbox', { category: 'insurance' })).items[0].priority).toBe(1);
  await run('update_insurance_case', { id: c.id, status: 'submitted', note: 'Report supplied' });
  await run('update_insurance_case', {
    id: c.id,
    status: 'approved',
    note: 'Approval received from insurer',
  });
  await run('update_insurance_case', {
    id: c.id,
    status: 'closed',
    note: 'Patient informed and file closed',
  });
  expect((await run('get_doctor_inbox', { category: 'insurance' })).total).toBe(0);
  expect(
    (await run('get_clinical_workspace', { patientId: patient })).insuranceHistory,
  ).toHaveLength(5);
});
it('keeps translated instructions as drafts with the approved source preserved', async () => {
  const work = await run('get_clinical_workspace', { patientId: patient }),
    source = work.instructions.find((i: any) => i.status === 'approved');
  const translated = await run('save_instruction_translation_draft', {
    sourceId: source.id,
    language: 'hi',
    body: 'डॉक्टर द्वारा समीक्षा आवश्यक',
  });
  const row = (await run('get_clinical_workspace', { patientId: patient })).instructions.find(
    (i: any) => i.id === translated.id,
  );
  expect(row).toMatchObject({
    status: 'draft',
    translated_from: source.id,
    translation_source: source.body,
  });
});
it('extracts stored PDF text locally with source ownership protection', async () => {
  const { default: PDFDocument } = await import('pdfkit');
  const pdf = new PDFDocument();
  const chunks: Buffer[] = [];
  const bytes = new Promise<Buffer>((resolve) => {
    pdf.on('data', (chunk) => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
  });
  pdf.text('Synthetic report value 5 units');
  pdf.end();
  const buffer = await bytes;
  const id = (
    await admin.query(
      "INSERT INTO patient_documents(clinic_id,patient_id,uploaded_via,filename,mime,size_bytes,data) VALUES($1,$2,'staff','text.pdf','application/pdf',$3,$4) RETURNING id",
      [clinic.clinicId, patient, buffer.length, buffer],
    )
  ).rows[0].id;
  const out = await run('extract_report_text', { patientId: patient, documentId: id });
  expect(out.pages[0].text).toContain('Synthetic report value 5 units');
  expect(out.verified).toBe(false);
  await expect(run('extract_report_text', { patientId: foreign, documentId: id })).rejects.toThrow(
    'not found',
  );
});
it('shows bounded prescription checks from verified records and exact duplicate lines', async () => {
  await run('add_clinical_entry', {
    patientId: patient,
    occurredOn: '2026-10-05',
    verified: true,
    data: { kind: 'allergy', substance: 'Syntheticallergen', reaction: 'recorded reaction' },
  });
  await run('add_clinical_entry', {
    patientId: patient,
    occurredOn: '2026-10-05',
    verified: true,
    data: {
      kind: 'medication',
      name: 'Existing medicine record',
      ingredient: 'Existingmedicine',
      dose: 'recorded dose',
      frequency: 'recorded frequency',
    },
  });
  const draft = await run('draft_prescription', {
    patientId: patient,
    content: {
      items: [
        { drug: 'Syntheticallergen', frequency: 'once', duration: 'one day' },
        { drug: 'Existingmedicine', frequency: 'once', duration: 'one day' },
        { drug: 'Existingmedicine', frequency: 'once', duration: 'one day' },
      ],
    },
  });
  expect(draft.warnings.some((warning: string) => warning.includes('verified allergy'))).toBe(true);
  expect(draft.warnings.some((warning: string) => warning.includes('active medicine'))).toBe(true);
  expect(draft.warnings.some((warning: string) => warning.includes('appears 2 times'))).toBe(true);
});
it('erasure clears follow-up and inbox details, holds signed sources, and de-identifies billing', async () => {
  await run('erase_patient_data', { patientId: patient });
  expect(
    (await admin.query('SELECT id FROM care_plans WHERE patient_id=$1', [patient])).rowCount,
  ).toBe(0);
  expect(
    (await admin.query('SELECT item_key FROM inbox_reviews WHERE patient_id=$1', [patient]))
      .rowCount,
  ).toBe(0);
  expect(
    (
      await admin.query(
        "SELECT id FROM patient_instructions WHERE patient_id=$1 AND status='approved'",
        [patient],
      )
    ).rowCount,
  ).toBe(1);
  expect(
    (
      await admin.query('SELECT patient_id,description FROM clinic_charges WHERE clinic_id=$1', [
        clinic.clinicId,
      ])
    ).rows[0],
  ).toMatchObject({ patient_id: null, description: 'Clinic charge (patient details removed)' });
  await expect(
    run('add_clinical_entry', {
      patientId: patient,
      occurredOn: '2026-10-01',
      data: { kind: 'diagnosis', name: 'New work' },
      verified: true,
    }),
  ).rejects.toThrow('unavailable');
});
