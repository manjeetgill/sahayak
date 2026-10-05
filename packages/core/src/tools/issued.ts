import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { t, type Lang } from '@sahayak/shared';
import { renderDocumentPdf } from '../pdf';
import { parsePrescriptionText } from '../prescription';
import { emitWebhook } from '../webhooks';
import { defineTool, ToolError, type ToolRun } from './registry';
import { deliver, ensureConversation, getSettings, hasConsent, storeMessage } from './common';

const DOCTOR = ['staff:doctor'];
const UUID = z.string().uuid();
const baseUrl = () => (process.env.PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const webUrl = () => (process.env.PUBLIC_WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');

const myDoctor = (ctx: { actor: any }): string => {
  if (ctx.actor.kind !== 'staff' || ctx.actor.role !== 'doctor' || !ctx.actor.doctorId)
    throw new ToolError('forbidden', 'Only a doctor can do this', 403);
  return ctx.actor.doctorId as string;
};

const RxItemSchema = z.object({
  drug: z.string().trim().min(1).max(80),
  strength: z.string().trim().max(40).optional(),
  form: z.string().trim().max(30).optional(),
  dose: z.string().trim().max(40).optional(),
  frequency: z.string().trim().max(60).optional(),
  duration: z.string().trim().max(40).optional(),
  instructions: z.string().trim().max(120).optional(),
});
const RxContent = z.object({
  items: z.array(RxItemSchema).max(20),
  advice: z.string().trim().max(500).optional(),
  follow_up: z.string().trim().max(200).optional(),
  allergies_noted: z.string().trim().max(200).optional(),
});
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const CertContent = z.object({
  examined_on: date.optional(),
  from_date: date.optional(),
  to_date: date.optional(),
  days: z.number().int().min(1).max(365).optional(),
  purpose: z.string().trim().max(120).optional(),
  remarks: z.string().trim().max(300).optional(),
  include_diagnosis: z.boolean().optional(),
  diagnosis: z.string().trim().max(200).optional(),
  confirm_fit: z.boolean().optional(),
});

/** Bounded exact/word checks against patient supplied and doctor verified records. A prompt to look, never a verdict. */
async function allergyWarnings(
  r: ToolRun,
  patientId: string,
  items: { drug: string }[],
): Promise<{ warnings: string[]; noted: string | null }> {
  const rows = (
    await r.db.query(
      'SELECT answers FROM intake_summaries WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 3',
      [patientId],
    )
  ).rows;
  const texts: string[] = [];
  for (const row of rows)
    for (const a of row.answers as { question: string; answer: string }[])
      if (/allerg/i.test(a.question)) texts.push(a.answer);
  const noted = texts[0] ?? null;
  const hay = texts.join(' ').toLowerCase();
  const warnings: string[] = [];
  const verified = (
    await r.db.query(
      "SELECT id,kind,data FROM clinical_entries WHERE patient_id=$1 AND status='active' AND verified_at IS NOT NULL AND kind IN ('medication','allergy')",
      [patientId],
    )
  ).rows;
  const exact = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
  const allergies = verified
    .filter((entry) => entry.kind === 'allergy')
    .map((entry) => ({ id: entry.id, substance: exact(entry.data.substance) }));
  const medicines = verified
    .filter((entry) => entry.kind === 'medication')
    .map((entry) => ({ id: entry.id, ingredient: exact(entry.data.ingredient) }));
  const seen = new Map<string, number>();
  for (const it of items) {
    const prescribed = exact(it.drug);
    seen.set(prescribed, (seen.get(prescribed) ?? 0) + 1);
    for (const allergy of allergies)
      if (prescribed === allergy.substance)
        warnings.push(
          `This prescription exactly matches the verified allergy record “${allergy.substance}”. Review the allergy and prescription before signing.`,
        );
    for (const medicine of medicines)
      if (prescribed === medicine.ingredient)
        warnings.push(
          `“${it.drug}” exactly matches a verified active medicine ingredient. Review whether this is an intentional continuation or a duplicate before signing.`,
        );
    for (const w of it.drug
      .toLowerCase()
      .split(/\s+/)
      .filter((x) => x.length >= 4)) {
      if (hay.includes(w))
        warnings.push(
          `The patient listed an allergy that mentions "${w}". Please check "${it.drug}" before signing.`,
        );
    }
  }
  for (const [drug, count] of seen)
    if (count > 1)
      warnings.push(
        `“${drug}” appears ${count} times in this prescription. Review whether the duplicate is intentional.`,
      );
  return { warnings: [...new Set(warnings)], noted };
}

export const draftCertificate = defineTool({
  name: 'draft_certificate',
  description:
    'Draft a medical certificate (sick leave, fitness or attendance) for the doctor to review and sign. The wording is fixed; only the details are filled in.',
  module: 'core',
  input: z.object({
    patientId: UUID,
    subtype: z.enum(['sick_leave', 'fitness', 'attendance']),
    content: CertContent,
    language: z.enum(['en', 'hi', 'both']).default('en'),
  }),
  allow: DOCTOR,
  auditInput: (i) => ({ patientId: i.patientId, subtype: i.subtype }),
  async run({ db, ctx }, i) {
    const doctorId = myDoctor(ctx);
    if (!(await db.query('SELECT 1 FROM patients WHERE id=$1', [i.patientId])).rowCount)
      throw new ToolError('not_found', 'Patient not found', 404);
    const r = await db.query(
      'INSERT INTO issued_documents (clinic_id,patient_id,doctor_id,kind,subtype,content,language,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [
        ctx.clinicId,
        i.patientId,
        doctorId,
        'certificate',
        i.subtype,
        JSON.stringify(i.content),
        i.language,
        ctx.actor.kind === 'staff' ? ctx.actor.userId : null,
      ],
    );
    return { documentId: r.rows[0].id as string };
  },
});

export const draftPrescription = defineTool({
  name: 'draft_prescription',
  description:
    "Draft a prescription from the doctor's own list (structured items, or dictated text). Medicines, doses and durations are copied exactly as given: they are never suggested, completed or corrected.",
  module: 'core',
  input: z.object({
    patientId: UUID,
    language: z.enum(['en', 'hi', 'both']).default('en'),
    content: RxContent.optional(),
    text: z.string().trim().min(2).max(3000).optional(),
  }),
  allow: DOCTOR,
  auditInput: (i) => ({ patientId: i.patientId }),
  auditOutput: (o: any) => ({ documentId: o.documentId }),
  async run(r, i) {
    const { db, ctx } = r;
    const doctorId = myDoctor(ctx);
    if (!i.content && !i.text)
      throw new ToolError('invalid_input', 'Provide the medicines as items or as text');
    if (!(await db.query('SELECT 1 FROM patients WHERE id=$1', [i.patientId])).rowCount)
      throw new ToolError('not_found', 'Patient not found', 404);
    let content = i.content;
    let incomplete: string[] = [];
    if (!content) {
      const p = parsePrescriptionText(i.text!);
      if (!p.items.length)
        throw new ToolError(
          'nothing_found',
          'No medicines could be read. Write one per line, e.g. "tab paracetamol 500 mg twice a day for 3 days".',
        );
      content = { items: p.items, advice: p.advice, follow_up: p.follow_up };
      incomplete = p.incomplete;
    }
    const al = await allergyWarnings(r, i.patientId, content.items);
    if (al.noted) content = { ...content, allergies_noted: al.noted.slice(0, 200) };
    const r2 = await db.query(
      'INSERT INTO issued_documents (clinic_id,patient_id,doctor_id,kind,subtype,content,language,warnings,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
      [
        ctx.clinicId,
        i.patientId,
        doctorId,
        'prescription',
        'prescription',
        JSON.stringify(content),
        i.language,
        JSON.stringify(al.warnings),
        ctx.actor.kind === 'staff' ? ctx.actor.userId : null,
      ],
    );
    return {
      documentId: r2.rows[0].id as string,
      items: content.items,
      incomplete,
      warnings: al.warnings,
    };
  },
});

export const updateIssuedDocument = defineTool({
  name: 'update_issued_document',
  description: 'Edit a draft certificate or prescription.',
  module: 'core',
  input: z.object({
    documentId: UUID,
    content: z.record(z.any()),
    language: z.enum(['en', 'hi', 'both']).optional(),
  }),
  allow: DOCTOR,
  auditInput: (i) => ({ documentId: i.documentId }),
  async run(r, i) {
    const { db, ctx } = r;
    const doctorId = myDoctor(ctx);
    const d = (
      await db.query(
        "SELECT id, kind, patient_id FROM issued_documents WHERE id=$1 AND status='draft' AND doctor_id=$2 FOR UPDATE",
        [i.documentId, doctorId],
      )
    ).rows[0];
    if (!d)
      throw new ToolError(
        'not_found',
        'No draft with that id (signed documents cannot be edited: void and reissue)',
        404,
      );
    const parsed =
      d.kind === 'prescription' ? RxContent.safeParse(i.content) : CertContent.safeParse(i.content);
    if (!parsed.success)
      throw new ToolError(
        'invalid_input',
        parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; '),
      );
    let warnings: string[] = [];
    if (d.kind === 'prescription')
      warnings = (await allergyWarnings(r, d.patient_id, (parsed.data as any).items)).warnings;
    await db.query(
      'UPDATE issued_documents SET content=$2, warnings=$3, language=COALESCE($4,language), updated_at=now() WHERE id=$1',
      [i.documentId, JSON.stringify(parsed.data), JSON.stringify(warnings), i.language ?? null],
    );
    return { ok: true, warnings };
  },
});

function validateForSigning(kind: string, subtype: string, c: any): string | null {
  if (kind === 'prescription') {
    if (!c.items?.length) return 'Add at least one medicine';
    for (const it of c.items) {
      if (!it.frequency) return `"${it.drug}": how often is missing`;
      if (!it.duration) return `"${it.drug}": duration is missing`;
    }
    return null;
  }
  if (subtype === 'sick_leave') {
    if (!c.from_date || !c.to_date) return 'Set the leave dates';
    if (c.to_date < c.from_date) return 'The end date is before the start date';
    return null;
  }
  if (subtype === 'fitness')
    return c.confirm_fit === true ? null : 'Confirm that you found the patient medically fit';
  return null;
}

export const signIssuedDocument = defineTool({
  name: 'sign_issued_document',
  description:
    'The doctor signs: the document gets its number and verification code, the PDF is generated, and it can no longer be changed.',
  module: 'core',
  input: z.object({ documentId: UUID, acknowledgeWarnings: z.boolean().default(false) }),
  allow: DOCTOR,
  auditInput: (i) => ({ documentId: i.documentId }),
  async run(r, i) {
    const { db, ctx } = r;
    const doctorId = myDoctor(ctx);
    const d = (
      await db.query(
        "SELECT * FROM issued_documents WHERE id=$1 AND status='draft' AND doctor_id=$2 FOR UPDATE",
        [i.documentId, doctorId],
      )
    ).rows[0];
    if (!d) throw new ToolError('not_found', 'No draft with that id', 404);
    const doc = (
      await db.query('SELECT name, qualifications, registration_no FROM doctors WHERE id=$1', [
        doctorId,
      ])
    ).rows[0];
    if (!doc.registration_no)
      throw new ToolError(
        'registration_required',
        'Add your medical registration number (Doctors screen) before signing certificates or prescriptions',
      );
    const problem = validateForSigning(d.kind, d.subtype, d.content);
    if (problem) throw new ToolError('incomplete_document', problem);
    if ((d.warnings as string[]).length && !i.acknowledgeWarnings)
      throw new ToolError(
        'warnings_not_acknowledged',
        'Please review the warnings and confirm before signing',
      );
    const content = { ...d.content };
    if (d.subtype === 'sick_leave' && !content.days)
      content.days =
        Math.round((Date.parse(content.to_date) - Date.parse(content.from_date)) / 86_400_000) + 1;
    const patient = (
      await db.query('SELECT name, year_of_birth FROM patients WHERE id=$1', [d.patient_id])
    ).rows[0];
    const s = await getSettings(db, ctx.clinicId);
    const number = (
      await db.query('SELECT next_doc_number($1) AS n', [d.kind === 'prescription' ? 'RX' : 'CERT'])
    ).rows[0].n as string;
    const verifyCode = randomBytes(6).toString('hex').toUpperCase();
    const signedAt = new Date();
    const pdf = await renderDocumentPdf({
      clinic: { name: s.clinic_name, address: s.address, phone: s.phone },
      doctor: {
        name: doc.name,
        qualifications: doc.qualifications,
        registrationNo: doc.registration_no,
      },
      patient: {
        name: patient.name,
        age: patient.year_of_birth ? new Date().getFullYear() - patient.year_of_birth : null,
      },
      doc: {
        kind: d.kind,
        subtype: d.subtype,
        content: { ...content, examined_on: content.examined_on ?? signedAt.toISOString() },
        language: d.language,
        number,
        signedAt,
        verifyCode,
      },
      verifyUrl: `${webUrl()}/verify/${verifyCode}`,
    });
    await db.query(
      "UPDATE issued_documents SET status='signed', content=$2, doc_number=$3, verify_code=$4, pdf=$5, signed_at=$6, signed_by=$7, updated_at=now() WHERE id=$1",
      [
        i.documentId,
        JSON.stringify(content),
        number,
        verifyCode,
        pdf,
        signedAt,
        ctx.actor.kind === 'staff' ? ctx.actor.userId : null,
      ],
    );
    await emitWebhook(
      db,
      ctx.clinicId,
      'document.issued',
      {
        documentId: i.documentId,
        kind: d.kind,
        subtype: d.subtype,
        patientId: d.patient_id,
        number,
      },
      { patientId: d.patient_id },
    );
    return { documentId: i.documentId, number, verifyCode };
  },
});

export const voidIssuedDocument = defineTool({
  name: 'void_issued_document',
  description:
    'Withdraw a signed document (e.g. issued by mistake). It stays on record, marked VOID, and its verification page says so.',
  module: 'core',
  input: z.object({ documentId: UUID, reason: z.string().trim().min(3).max(300) }),
  allow: DOCTOR,
  auditInput: (i) => ({ documentId: i.documentId }),
  async run({ db, ctx }, i) {
    const doctorId = myDoctor(ctx);
    const u = await db.query(
      "UPDATE issued_documents SET status='void', void_reason=$2, voided_at=now() WHERE id=$1 AND status='signed' AND doctor_id=$3 RETURNING id",
      [i.documentId, i.reason, doctorId],
    );
    if (!u.rowCount) throw new ToolError('not_found', 'No signed document with that id', 404);
    await db.query('DELETE FROM document_links WHERE document_id=$1', [i.documentId]); // links stop working
    return { ok: true };
  },
});

export const deleteIssuedDraft = defineTool({
  name: 'delete_issued_draft',
  description: 'Discard an unsigned draft.',
  module: 'core',
  input: z.object({ documentId: UUID }),
  allow: DOCTOR,
  auditInput: (i) => ({ documentId: i.documentId }),
  async run({ db, ctx }, { documentId }) {
    const d = await db.query(
      "DELETE FROM issued_documents WHERE id=$1 AND status='draft' AND doctor_id=$2 RETURNING id",
      [documentId, myDoctor(ctx)],
    );
    if (!d.rowCount) throw new ToolError('not_found', 'No draft with that id', 404);
    return { ok: true };
  },
});

export const getIssuedDocumentPdf = defineTool({
  name: 'get_issued_document_pdf',
  description: 'Download the signed PDF (doctor; recorded in the audit log).',
  module: 'core',
  input: z.object({ documentId: UUID }),
  allow: [...DOCTOR, 'staff:receptionist'],
  auditInput: (i) => ({ documentId: i.documentId }),
  auditOutput: (o: any) => ({ number: o.number, bytes: o.pdf.length }),
  async run({ db }, { documentId }) {
    const d = (
      await db.query(
        "SELECT pdf, doc_number FROM issued_documents WHERE id=$1 AND status IN ('signed','void')",
        [documentId],
      )
    ).rows[0];
    if (!d) throw new ToolError('not_found', 'No signed document with that id', 404);
    return { pdf: d.pdf as Buffer, number: d.doc_number as string };
  },
});

export const sendIssuedDocument = defineTool({
  name: 'send_issued_document',
  description:
    "Send the signed document to the patient on WhatsApp as a private download link (7 days, 5 downloads). Needs the patient's messaging consent.",
  module: 'core',
  input: z.object({ documentId: UUID }),
  allow: [...DOCTOR, 'staff:receptionist'],
  auditInput: (i) => ({ documentId: i.documentId }),
  auditOutput: () => ({ sent: true }), // the link itself is a secret: never log it
  async run(r, { documentId }) {
    const { db, ctx } = r;
    const d = (
      await db.query(
        "SELECT d.*, dr.name AS doctor_name FROM issued_documents d JOIN doctors dr ON dr.id=d.doctor_id WHERE d.id=$1 AND d.status='signed'",
        [documentId],
      )
    ).rows[0];
    if (!d)
      throw new ToolError(
        'not_found',
        'No signed document with that id (voided documents cannot be sent)',
        404,
      );
    const p = (
      await db.query('SELECT id, phone, language FROM patients WHERE id=$1', [d.patient_id])
    ).rows[0];
    if (!(await hasConsent(db, p.id, 'whatsapp_messaging')))
      throw new ToolError(
        'no_consent',
        'The patient has not agreed to WhatsApp messages. Download the PDF and hand it over instead.',
      );
    const token = randomBytes(24).toString('base64url');
    const days = 7;
    await db.query(
      'INSERT INTO document_links (clinic_id,document_id,token_hash,expires_at) VALUES ($1,$2,$3, now() + make_interval(days => $4))',
      [ctx.clinicId, documentId, createHash('sha256').update(token).digest('hex'), days],
    );
    const lang = p.language as Lang;
    const text = t(lang, 'msg.document_ready', {
      doctor: d.doctor_name,
      kind: t(lang, `doc.kind.${d.kind}` as any),
      number: d.doc_number,
      link: `${baseUrl()}/d/${token}`,
      days,
    });
    const conv = await ensureConversation(db, ctx.clinicId, p.phone, p.id, lang);
    await storeMessage(
      db,
      ctx.clinicId,
      conv.id,
      'out',
      ctx.actor.kind === 'staff' ? `staff:${ctx.actor.userId}` : 'system',
      text.replace(token, '…'),
    );
    await deliver(r, { to: p.phone, text, lang });
    await db.query('UPDATE issued_documents SET sent_at=now() WHERE id=$1', [documentId]);
    r.emit({ type: 'conversation_updated', conversationId: conv.id });
    return { ok: true };
  },
});

export const listIssuedDocuments = defineTool({
  name: 'list_issued_documents',
  description: 'Certificates and prescriptions for one patient.',
  module: 'core',
  scope: 'read',
  input: z.object({ patientId: UUID }),
  allow: DOCTOR,
  auditInput: (i) => ({ patientId: i.patientId }),
  auditOutput: (o: any) => ({ count: o.documents.length }),
  async run({ db }, { patientId }) {
    const rows = (
      await db.query(
        'SELECT id, kind, subtype, status, doc_number, content, language, warnings, created_at, signed_at, sent_at, void_reason FROM issued_documents WHERE patient_id=$1 ORDER BY created_at DESC',
        [patientId],
      )
    ).rows;
    return { documents: rows };
  },
});

export const issuedTools = [
  draftCertificate,
  draftPrescription,
  updateIssuedDocument,
  signIssuedDocument,
  voidIssuedDocument,
  deleteIssuedDraft,
  getIssuedDocumentPdf,
  sendIssuedDocument,
  listIssuedDocuments,
];
