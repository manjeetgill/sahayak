import { z } from 'zod';
import { defineTool, ToolError } from './registry';
import { assertOwn } from './common';

const DOCTOR = ['staff:doctor'];
const UUID = z.string().uuid();
export const NOTE_FIELDS = [
  'complaint',
  'history',
  'examination',
  'diagnosis',
  'plan',
  'follow_up',
  'assessment',
  'differential',
  'investigations',
  'instructions',
] as const;
export const NoteSchema = z.object(
  Object.fromEntries(NOTE_FIELDS.map((f) => [f, z.string().max(4000).optional()])) as Record<
    (typeof NOTE_FIELDS)[number],
    z.ZodOptional<z.ZodString>
  >,
);
export type NoteContent = z.infer<typeof NoteSchema>;

const myDoctor = (ctx: { actor: any }): string => {
  if (ctx.actor.kind !== 'staff' || ctx.actor.role !== 'doctor' || !ctx.actor.doctorId)
    throw new ToolError('forbidden', 'Only a doctor can do this', 403);
  return ctx.actor.doctorId as string;
};
const clean = (n: NoteContent): NoteContent =>
  Object.fromEntries(
    Object.entries(n)
      .filter(([, v]) => typeof v === 'string' && v.trim())
      .map(([k, v]) => [k, (v as string).trim()]),
  ) as NoteContent;

export const searchPatients = defineTool({
  name: 'search_patients',
  description: 'Find patients by name or phone (no clinical content).',
  module: 'core',
  scope: 'read',
  input: z.object({ q: z.string().trim().min(2).max(60) }),
  allow: [...DOCTOR, 'staff:receptionist'],
  auditInput: () => ({ search: true }),
  auditOutput: (o: any) => ({ results: o.patients.length }),
  async run({ db }, { q }) {
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const rows = (
      await db.query(
        "SELECT id, name, phone, year_of_birth, tags FROM patients WHERE name <> 'Erased patient' AND (name ILIKE $1 OR phone LIKE $1) ORDER BY name LIMIT 20",
        [like],
      )
    ).rows;
    return {
      patients: rows.map((p) => ({
        id: p.id,
        name: p.name,
        phone: p.phone,
        age: p.year_of_birth ? new Date().getFullYear() - p.year_of_birth : null,
        tags: p.tags,
      })),
    };
  },
});

export const setPatientTags = defineTool({
  name: 'set_patient_tags',
  description:
    'Label a patient (e.g. "diabetes") so custom agents can address groups. Doctor only.',
  module: 'core',
  input: z.object({
    patientId: UUID,
    tags: z
      .array(
        z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9][a-z0-9 _-]{0,29}$/),
      )
      .max(10),
  }),
  allow: DOCTOR,
  auditInput: (i) => ({ patientId: i.patientId, tagCount: i.tags.length }),
  async run({ db }, i) {
    const u = await db.query('UPDATE patients SET tags=$2 WHERE id=$1 RETURNING id', [
      i.patientId,
      [...new Set(i.tags)],
    ]);
    if (!u.rowCount) throw new ToolError('not_found', 'Patient not found', 404);
    return { ok: true };
  },
});

export const getPatientRecord = defineTool({
  name: 'get_patient_record',
  description:
    "Open a patient's clinical record (notes, documents, visits). Every opening is recorded in the audit log.",
  module: 'core',
  input: z.object({ patientId: UUID }),
  allow: DOCTOR,
  auditInput: (i) => ({ patientId: i.patientId, action: 'opened record' }),
  auditOutput: (o: any) => ({ notes: o.notes.length, documents: o.documents.length }),
  async run({ db }, { patientId }) {
    const p = (
      await db.query(
        'SELECT id, name, phone, language, year_of_birth, tags, created_at, clinical_hold_until FROM patients WHERE id=$1',
        [patientId],
      )
    ).rows[0];
    if (!p) throw new ToolError('not_found', 'Patient not found', 404);
    const notes = (
      await db.query(
        `SELECT n.id, n.doctor_id, n.queue_entry_id, n.transcript, n.status, n.source, n.note, n.flags, n.amends_note_id, n.amend_reason, n.created_at, n.signed_at, d.name AS doctor
           FROM visit_notes n JOIN doctors d ON d.id=n.doctor_id WHERE n.patient_id=$1 ORDER BY n.created_at DESC`,
        [patientId],
      )
    ).rows;
    const documents = (
      await db.query(
        'SELECT id, kind, filename, mime, size_bytes, caption, status, uploaded_via, created_at FROM patient_documents WHERE patient_id=$1 ORDER BY created_at DESC',
        [patientId],
      )
    ).rows;
    const visits = (
      await db.query(
        'SELECT id, doctor_id, queue_date, status, token_number FROM queue_entries WHERE patient_id=$1 ORDER BY queue_date DESC, token_number DESC LIMIT 15',
        [patientId],
      )
    ).rows;
    const intake = (
      await db.query(
        'SELECT id, created_at, answers, summary FROM intake_summaries WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 5',
        [patientId],
      )
    ).rows;
    const upcoming = (
      await db.query(
        "SELECT starts_at, status FROM appointments WHERE patient_id=$1 AND starts_at > now() AND status IN ('booked','checked_in') ORDER BY starts_at LIMIT 5",
        [patientId],
      )
    ).rows;
    return {
      patient: { ...p, age: p.year_of_birth ? new Date().getFullYear() - p.year_of_birth : null },
      notes,
      documents,
      visits,
      intake,
      upcoming,
    };
  },
});

export const saveVisitNoteDraft = defineTool({
  name: 'save_visit_note_draft',
  description:
    "Store a draft visit note (what the doctor said, and the scribe's structured version). A draft is never part of the record until the doctor signs it.",
  module: 'core',
  input: z.object({
    patientId: UUID,
    transcript: z.string().trim().min(1).max(12000),
    source: z.enum(['typed', 'dictated']).default('typed'),
    note: NoteSchema,
    flags: z.array(z.string().max(200)).max(10).default([]),
    queueEntryId: UUID.optional(),
  }),
  allow: DOCTOR,
  auditInput: (i) => ({ patientId: i.patientId, transcriptChars: i.transcript.length }),
  async run({ db, ctx }, i) {
    const doctorId = myDoctor(ctx);
    if (!(await db.query('SELECT 1 FROM patients WHERE id=$1', [i.patientId])).rowCount)
      throw new ToolError('not_found', 'Patient not found', 404);
    if (
      i.queueEntryId &&
      !(
        await db.query(
          'SELECT 1 FROM queue_entries WHERE id=$1 AND patient_id=$2 AND doctor_id=$3',
          [i.queueEntryId, i.patientId, doctorId],
        )
      ).rowCount
    )
      throw new ToolError('wrong_visit', 'Visit must belong to this patient and doctor');
    const r = await db.query(
      `INSERT INTO visit_notes (clinic_id,patient_id,doctor_id,queue_entry_id,source,transcript,note,flags,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        ctx.clinicId,
        i.patientId,
        doctorId,
        i.queueEntryId ?? null,
        i.source,
        i.transcript,
        JSON.stringify(clean(i.note)),
        JSON.stringify(i.flags),
        ctx.actor.kind === 'staff' ? ctx.actor.userId : null,
      ],
    );
    return { noteId: r.rows[0].id as string };
  },
});

export const updateVisitNote = defineTool({
  name: 'update_visit_note',
  description: 'Edit a draft note.',
  module: 'core',
  input: z.object({ noteId: UUID, note: NoteSchema }),
  allow: DOCTOR,
  auditInput: (i) => ({ noteId: i.noteId }),
  async run({ db, ctx }, i) {
    const doctorId = myDoctor(ctx);
    const u = await db.query(
      "UPDATE visit_notes SET note=$2, updated_at=now() WHERE id=$1 AND status='draft' AND doctor_id=$3 RETURNING id",
      [i.noteId, JSON.stringify(clean(i.note)), doctorId],
    );
    if (!u.rowCount)
      throw new ToolError(
        'not_found',
        'No editable draft with that id (signed notes cannot be edited: amend them)',
        404,
      );
    return { ok: true };
  },
});

export const signVisitNote = defineTool({
  name: 'sign_visit_note',
  description: 'The doctor signs the note. From then on it cannot be changed, only amended.',
  module: 'core',
  input: z.object({ noteId: UUID }),
  allow: DOCTOR,
  auditInput: (i) => ({ noteId: i.noteId }),
  async run({ db, ctx }, { noteId }) {
    const doctorId = myDoctor(ctx);
    const n = (
      await db.query(
        "SELECT note FROM visit_notes WHERE id=$1 AND status='draft' AND doctor_id=$2 FOR UPDATE",
        [noteId, doctorId],
      )
    ).rows[0];
    if (!n) throw new ToolError('not_found', 'No draft with that id', 404);
    if (!Object.keys(n.note).length)
      throw new ToolError('empty_note', 'Add at least one section before signing');
    await db.query(
      "UPDATE visit_notes SET status='signed', signed_at=now(), signed_by=$2 WHERE id=$1",
      [noteId, ctx.actor.kind === 'staff' ? ctx.actor.userId : null],
    );
    return { ok: true };
  },
});

export const amendVisitNote = defineTool({
  name: 'amend_visit_note',
  description:
    'Start a correction to a signed note. The original stays on record; a new draft links to it.',
  module: 'core',
  input: z.object({ noteId: UUID, reason: z.string().trim().min(3).max(300) }),
  allow: DOCTOR,
  auditInput: (i) => ({ noteId: i.noteId }),
  async run({ db, ctx }, i) {
    const doctorId = myDoctor(ctx);
    const o = (
      await db.query("SELECT * FROM visit_notes WHERE id=$1 AND status='signed' AND doctor_id=$2", [
        i.noteId,
        doctorId,
      ])
    ).rows[0];
    if (!o) throw new ToolError('not_found', 'No signed note with that id', 404);
    const r = await db.query(
      `INSERT INTO visit_notes (clinic_id,patient_id,doctor_id,queue_entry_id,source,transcript,note,amends_note_id,amend_reason,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        ctx.clinicId,
        o.patient_id,
        doctorId,
        o.queue_entry_id,
        o.source,
        o.transcript,
        JSON.stringify(o.note),
        i.noteId,
        i.reason,
        ctx.actor.kind === 'staff' ? ctx.actor.userId : null,
      ],
    );
    return { noteId: r.rows[0].id as string };
  },
});

export const deleteVisitNoteDraft = defineTool({
  name: 'delete_visit_note_draft',
  description: 'Discard an unsigned draft.',
  module: 'core',
  input: z.object({ noteId: UUID }),
  allow: DOCTOR,
  auditInput: (i) => ({ noteId: i.noteId }),
  async run({ db, ctx }, { noteId }) {
    const d = await db.query(
      "DELETE FROM visit_notes WHERE id=$1 AND status='draft' AND doctor_id=$2 RETURNING id",
      [noteId, myDoctor(ctx)],
    );
    if (!d.rowCount) throw new ToolError('not_found', 'No draft with that id', 404);
    return { ok: true };
  },
});

// ---------- documents ----------

const SIGNATURES: [string, (b: Buffer) => boolean][] = [
  ['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  [
    'image/png',
    (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  ],
  ['application/pdf', (b) => b.subarray(0, 5).toString('latin1') === '%PDF-'],
  [
    'image/webp',
    (b) =>
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'WEBP',
  ],
];
/** What kind of file is this really? Judged by its first bytes, never by the name or the type the sender claims. */
export function sniffMime(buf: Buffer): string | null {
  return SIGNATURES.find(([, test]) => test(buf))?.[0] ?? null;
}
// Keep letters, digits and a few safe symbols (any script); everything else becomes an underscore.
const safeName = (n: string) => n.replace(/[^\p{L}\p{N}._ ()-]/gu, '_').slice(0, 80) || 'file';

export const storePatientDocument = defineTool({
  name: 'store_patient_document',
  description:
    "Add a report, photo or scan to a patient's record. Accepts JPEG, PNG, WebP and PDF up to 8 MB; the file type is checked from its contents.",
  module: 'core',
  input: z.object({
    patientId: UUID,
    filename: z.string().trim().min(1).max(120),
    base64: z.string().min(8).max(12_000_000),
    caption: z.string().trim().max(200).optional(),
    kind: z.enum(['report', 'photo', 'xray', 'other']).default('report'),
  }),
  allow: ['patient', 'system', 'staff:doctor', 'staff:receptionist'],
  auditInput: (i) => ({ patientId: i.patientId, filename: i.filename, kind: i.kind }),
  async run({ db, ctx }, i) {
    assertOwn(ctx, i.patientId);
    const buf = Buffer.from(i.base64, 'base64');
    if (!buf.length || buf.length > 8 * 1024 * 1024)
      throw new ToolError('file_too_large', 'Files must be 8 MB or smaller');
    const mime = sniffMime(buf);
    if (!mime)
      throw new ToolError('unsupported_file', 'Only JPEG, PNG, WebP and PDF files are accepted');
    if (!(await db.query('SELECT 1 FROM patients WHERE id=$1', [i.patientId])).rowCount)
      throw new ToolError('not_found', 'Patient not found', 404);
    const r = await db.query(
      'INSERT INTO patient_documents (clinic_id,patient_id,uploaded_via,kind,filename,mime,size_bytes,data,caption) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
      [
        ctx.clinicId,
        i.patientId,
        ctx.actor.kind === 'staff' ? 'staff' : 'whatsapp',
        i.kind,
        safeName(i.filename),
        mime,
        buf.length,
        buf,
        i.caption ?? null,
      ],
    );
    return { documentId: r.rows[0].id as string, mime, size: buf.length };
  },
});

export const getPatientDocument = defineTool({
  name: 'get_patient_document',
  description: 'Download one document (doctor only; recorded in the audit log).',
  module: 'core',
  input: z.object({ documentId: UUID }),
  allow: DOCTOR,
  auditInput: (i) => ({ documentId: i.documentId }),
  auditOutput: (o: any) => ({ mime: o.mime, size: o.size }),
  async run({ db, ctx }, { documentId }) {
    const d = (
      await db.query(
        'SELECT id, filename, mime, size_bytes, data, status FROM patient_documents WHERE id=$1',
        [documentId],
      )
    ).rows[0];
    if (!d) throw new ToolError('not_found', 'Document not found', 404);
    if (d.status === 'new')
      await db.query("UPDATE patient_documents SET status='reviewed', reviewed_by=$2 WHERE id=$1", [
        documentId,
        ctx.actor.kind === 'staff' ? ctx.actor.userId : null,
      ]);
    return {
      filename: d.filename as string,
      mime: d.mime as string,
      size: d.size_bytes as number,
      data: d.data as Buffer,
    };
  },
});

export const recordTools = [
  searchPatients,
  setPatientTags,
  getPatientRecord,
  saveVisitNoteDraft,
  updateVisitNote,
  signVisitNote,
  amendVisitNote,
  deleteVisitNoteDraft,
  storePatientDocument,
  getPatientDocument,
];
