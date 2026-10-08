import { z } from 'zod';
import { parsePrescriptionText } from '../prescription';
import { defineTool, ToolError } from './registry';
import { draftPrescription } from './issued';

const DOCTOR = ['staff:doctor'];
const UUID = z.string().uuid();
const MAX_TEMPLATES = 30;
const MAX_MEDICINES = 60;

const myDoctor = (ctx: { actor: any }): string => {
  if (ctx.actor.kind !== 'staff' || ctx.actor.role !== 'doctor' || !ctx.actor.doctorId)
    throw new ToolError('forbidden', 'Only a doctor can do this', 403);
  return ctx.actor.doctorId as string;
};

/**
 * Starting points with headings and blanks only. They contain no medical content and no advice: the doctor
 * fills the blanks (or deletes them) before anything is arranged or signed.
 */
export const STARTER_TEMPLATES: { name: string; body: string }[] = [
  {
    name: 'General visit',
    body: 'Complaint: ___\nHistory: ___\nExamination: ___\nDiagnosis: ___\nPlan: ___\nFollow up: ___',
  },
  {
    name: 'Follow-up visit',
    body: 'Complaint: follow-up. ___\nExamination: ___\nPlan: ___\nFollow up: ___',
  },
  {
    name: 'Fever',
    body: 'Complaint: fever for ___ days\nExamination: temperature ___\nDiagnosis: ___\nPlan: ___\nFollow up: ___',
  },
];

export const listVisitShortcuts = defineTool({
  name: 'list_visit_shortcuts',
  description: "The doctor's visit templates and favourite medicine lines.",
  module: 'core',
  scope: 'read',
  input: z.object({}),
  allow: DOCTOR,
  auditInput: () => ({}),
  auditOutput: (o: any) => ({ templates: o.templates.length, medicines: o.medicines.length }),
  async run({ db, ctx }) {
    const doctorId = myDoctor(ctx);
    return {
      templates: (
        await db.query(
          'SELECT id, name, body FROM visit_templates WHERE doctor_id=$1 ORDER BY lower(name)',
          [doctorId],
        )
      ).rows as { id: string; name: string; body: string }[],
      medicines: (
        await db.query(
          'SELECT id, line FROM favourite_medicines WHERE doctor_id=$1 ORDER BY line',
          [doctorId],
        )
      ).rows as { id: string; line: string }[],
    };
  },
});

export const saveVisitTemplate = defineTool({
  name: 'save_visit_template',
  description:
    'Save (or replace, by name) a visit template: the headings and wording the doctor starts from.',
  module: 'core',
  input: z.object({
    name: z.string().trim().min(2).max(60),
    body: z.string().trim().min(1).max(4000),
  }),
  allow: DOCTOR,
  auditInput: (i) => ({ nameChars: i.name.length, bodyChars: i.body.length }),
  async run({ db, ctx }, i) {
    const doctorId = myDoctor(ctx);
    const exists = (
      await db.query(
        'SELECT id FROM visit_templates WHERE doctor_id=$1 AND lower(name)=lower($2)',
        [doctorId, i.name],
      )
    ).rows[0];
    if (
      !exists &&
      ((
        await db.query('SELECT count(*)::int n FROM visit_templates WHERE doctor_id=$1', [doctorId])
      ).rows[0].n as number) >= MAX_TEMPLATES
    )
      throw new ToolError(
        'too_many',
        `You can keep up to ${MAX_TEMPLATES} templates. Delete one first.`,
      );
    const r = exists
      ? await db.query(
          'UPDATE visit_templates SET name=$2, body=$3, updated_at=now() WHERE id=$1 RETURNING id',
          [exists.id, i.name, i.body],
        )
      : await db.query(
          'INSERT INTO visit_templates (clinic_id,doctor_id,name,body) VALUES ($1,$2,$3,$4) RETURNING id',
          [ctx.clinicId, doctorId, i.name, i.body],
        );
    return { id: r.rows[0].id as string };
  },
});

export const deleteVisitTemplate = defineTool({
  name: 'delete_visit_template',
  description: 'Delete one of my visit templates.',
  module: 'core',
  input: z.object({ id: UUID }),
  allow: DOCTOR,
  auditInput: (i) => ({ id: i.id }),
  async run({ db, ctx }, { id }) {
    const d = await db.query(
      'DELETE FROM visit_templates WHERE id=$1 AND doctor_id=$2 RETURNING id',
      [id, myDoctor(ctx)],
    );
    if (!d.rowCount) throw new ToolError('not_found', 'Template not found', 404);
    return { ok: true };
  },
});

export const addStarterTemplates = defineTool({
  name: 'add_starter_templates',
  description: 'Add the three starter templates (headings and blanks only) to my list.',
  module: 'core',
  input: z.object({}),
  allow: DOCTOR,
  auditInput: () => ({}),
  async run({ db, ctx }) {
    const doctorId = myDoctor(ctx);
    let added = 0;
    for (const t of STARTER_TEMPLATES) {
      const r = await db.query(
        'INSERT INTO visit_templates (clinic_id,doctor_id,name,body) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [ctx.clinicId, doctorId, t.name, t.body],
      );
      added += r.rowCount ?? 0;
    }
    return { added };
  },
});

export const saveFavouriteMedicine = defineTool({
  name: 'save_favourite_medicine',
  description:
    'Keep a medicine line the doctor prescribes often, written exactly as they would dictate it.',
  module: 'core',
  input: z.object({ line: z.string().trim().min(2).max(200) }),
  allow: DOCTOR,
  auditInput: () => ({}),
  async run({ db, ctx }, { line }) {
    const doctorId = myDoctor(ctx);
    const parsed = parsePrescriptionText(line);
    if (parsed.items.length !== 1)
      throw new ToolError(
        'one_line',
        'Write one medicine per line, for example "tab paracetamol 500 mg twice a day for 3 days".',
      );
    if (
      ((
        await db.query('SELECT count(*)::int n FROM favourite_medicines WHERE doctor_id=$1', [
          doctorId,
        ])
      ).rows[0].n as number) >= MAX_MEDICINES
    )
      throw new ToolError(
        'too_many',
        `You can keep up to ${MAX_MEDICINES} favourite medicines. Delete one first.`,
      );
    const r = await db.query(
      'INSERT INTO favourite_medicines (clinic_id,doctor_id,line) VALUES ($1,$2,$3) ON CONFLICT (doctor_id, line) DO UPDATE SET line=EXCLUDED.line RETURNING id',
      [ctx.clinicId, doctorId, line],
    );
    return { id: r.rows[0].id as string, incomplete: parsed.incomplete };
  },
});

export const deleteFavouriteMedicine = defineTool({
  name: 'delete_favourite_medicine',
  description: 'Remove a favourite medicine line.',
  module: 'core',
  input: z.object({ id: UUID }),
  allow: DOCTOR,
  auditInput: (i) => ({ id: i.id }),
  async run({ db, ctx }, { id }) {
    const d = await db.query(
      'DELETE FROM favourite_medicines WHERE id=$1 AND doctor_id=$2 RETURNING id',
      [id, myDoctor(ctx)],
    );
    if (!d.rowCount) throw new ToolError('not_found', 'Not found', 404);
    return { ok: true };
  },
});

/**
 * "Same as last time": copy the patient's most recent signed prescription into a NEW DRAFT. Allergy warnings are
 * recomputed for the patient as they are now, and the doctor reviews, edits and signs it like any other draft.
 */
export const repeatLastPrescription = defineTool({
  name: 'repeat_last_prescription',
  description: "Copy this patient's most recent signed prescription into a new draft for review.",
  module: 'core',
  input: z.object({ patientId: UUID, language: z.enum(['en', 'hi', 'both']).optional() }),
  allow: DOCTOR,
  auditInput: (i) => ({ patientId: i.patientId }),
  auditOutput: (o: any) => ({ documentId: o.documentId }),
  async run(r, i) {
    const prev = (
      await r.db.query(
        "SELECT content, language, doc_number, signed_at FROM issued_documents WHERE patient_id=$1 AND kind='prescription' AND status='signed' ORDER BY signed_at DESC LIMIT 1",
        [i.patientId],
      )
    ).rows[0];
    if (!prev)
      throw new ToolError(
        'nothing_to_repeat',
        'This patient has no signed prescription to repeat.',
        404,
      );
    const out = await draftPrescription.run(r, {
      patientId: i.patientId,
      language: i.language ?? prev.language,
      content: {
        items: prev.content.items,
        advice: prev.content.advice,
        follow_up: prev.content.follow_up,
      },
    });
    return { ...out, copiedFrom: prev.doc_number as string, copiedOn: prev.signed_at as Date };
  },
});

export const shortcutTools = [
  listVisitShortcuts,
  saveVisitTemplate,
  deleteVisitTemplate,
  addStarterTemplates,
  saveFavouriteMedicine,
  deleteFavouriteMedicine,
  repeatLastPrescription,
];
