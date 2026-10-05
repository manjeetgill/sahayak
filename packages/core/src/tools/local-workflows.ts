import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { defineTool, ToolError, type ToolRun } from './registry';
import { createCarePlan } from './clinical-workbench';
const UUID = z.string().uuid(),
  text = z.string().trim().min(1).max(2000),
  allow = ['staff:doctor'];
const actor = (r: ToolRun) => (r.ctx.actor.kind === 'staff' ? r.ctx.actor.userId : null);
async function available(r: ToolRun, patientId: string) {
  if (
    !(
      await r.db.query(
        "SELECT id FROM patients WHERE id=$1 AND erasure_requested_at IS NULL AND name<>'Erased patient'",
        [patientId],
      )
    ).rowCount
  )
    throw new ToolError('patient', 'Patient unavailable', 404);
}
const templates = defineTool({
  name: 'list_care_templates',
  module: 'core',
  description: 'Clinic task wording and schedules with immutable versions.',
  allow,
  input: z.object({}),
  auditOutput: () => ({ listed: true }),
  async run(r) {
    return {
      templates: (
        await r.db.query(
          'SELECT t.*,u.name AS author FROM care_templates t JOIN staff_users u ON u.id=t.created_by ORDER BY t.created_at DESC',
        )
      ).rows,
    };
  },
});
const saveTemplate = defineTool({
  name: 'save_care_template',
  module: 'core',
  description: 'Save a new draft version of reusable clinic wording; no patient identifiers.',
  allow,
  input: z.object({
    previousId: UUID.optional(),
    title: text,
    steps: z
      .array(z.object({ title: text, message: text, afterDays: z.number().int().min(0).max(365) }))
      .min(1)
      .max(12),
  }),
  auditInput: () => ({ template: true }),
  auditOutput: () => ({ saved: true }),
  async run(r, i) {
    let family = randomUUID(),
      version = 1;
    if (i.previousId) {
      const previous = (
        await r.db.query('SELECT * FROM care_templates WHERE id=$1 FOR UPDATE', [i.previousId])
      ).rows[0];
      if (!previous) throw new ToolError('not_found', 'Template not found', 404);
      family = previous.family_id;
      await r.db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [family]);
      version =
        Number(
          (
            await r.db.query(
              'SELECT max(version) AS version FROM care_templates WHERE family_id=$1',
              [family],
            )
          ).rows[0].version,
        ) + 1;
    }
    return (
      await r.db.query(
        'INSERT INTO care_templates(clinic_id,family_id,version,title,steps,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
        [r.ctx.clinicId, family, version, i.title, JSON.stringify(i.steps), actor(r)],
      )
    ).rows[0];
  },
});
const reviewTemplate = defineTool({
  name: 'review_care_template',
  module: 'core',
  description: 'Approve or retire a clinic task template.',
  allow,
  input: z.object({ id: UUID, action: z.enum(['approve', 'archive']) }),
  async run(r, i) {
    const row = (await r.db.query('SELECT * FROM care_templates WHERE id=$1 FOR UPDATE', [i.id]))
      .rows[0];
    if (!row) throw new ToolError('not_found', 'Template not found', 404);
    if (i.action === 'approve') {
      if (row.archived_at)
        throw new ToolError('archived', 'Create a new version of this retired template');
      await r.db.query(
        'UPDATE care_templates SET approved_at=COALESCE(approved_at,now()),approved_by=COALESCE(approved_by,$2) WHERE id=$1',
        [i.id, actor(r)],
      );
    } else
      await r.db.query(
        'UPDATE care_templates SET archived_at=COALESCE(archived_at,now()) WHERE id=$1',
        [i.id],
      );
    return { saved: true };
  },
});
const applyTemplate = defineTool({
  name: 'apply_care_template',
  module: 'core',
  description:
    'Create a patient-specific draft from an approved template. Requires separate plan approval.',
  allow,
  input: z.object({
    id: UUID,
    patientId: UUID,
    assignedTo: UUID,
    startAt: z.string().datetime(),
    requestId: UUID,
  }),
  async run(r, i) {
    await available(r, i.patientId);
    await r.db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [r.ctx.clinicId + i.requestId]);
    const existing = (
      await r.db.query(
        'SELECT id,patient_id,template_id,assigned_to,template_start_at FROM care_plans WHERE creation_request=$1',
        [i.requestId],
      )
    ).rows[0];
    if (existing) {
      if (
        existing.patient_id !== i.patientId ||
        existing.template_id !== i.id ||
        existing.assigned_to !== i.assignedTo ||
        new Date(existing.template_start_at).toISOString() !== new Date(i.startAt).toISOString()
      )
        throw new ToolError('conflict', 'This request was already used for another plan');
      return { id: existing.id };
    }
    const t = (
      await r.db.query(
        'SELECT * FROM care_templates WHERE id=$1 AND approved_at IS NOT NULL AND archived_at IS NULL FOR SHARE',
        [i.id],
      )
    ).rows[0];
    if (!t) throw new ToolError('approval', 'Choose an approved, current template');
    const draft = await createCarePlan.run(r, {
      patientId: i.patientId,
      assignedTo: i.assignedTo,
      title: t.title,
      steps: t.steps.map((s: any) => ({
        title: s.title,
        message: s.message,
        dueAt: new Date(Date.parse(i.startAt) + s.afterDays * 86400000).toISOString(),
      })),
    });
    await r.db.query(
      'UPDATE care_plans SET template_id=$2,creation_request=$3,template_start_at=$4 WHERE id=$1',
      [draft.id, i.id, i.requestId, i.startAt],
    );
    return draft;
  },
});
const reviewResult = defineTool({
  name: 'review_clinical_result',
  module: 'core',
  description: 'Record doctor review of a verified numeric result.',
  allow,
  input: z.object({ id: UUID, note: text }),
  auditInput: (i) => ({ id: i.id }),
  auditOutput: () => ({ reviewed: true }),
  async run(r, i) {
    const e = (
      await r.db.query(
        "SELECT * FROM clinical_entries WHERE id=$1 AND kind='lab' AND status='active' AND verified_at IS NOT NULL FOR UPDATE",
        [i.id],
      )
    ).rows[0];
    if (!e) throw new ToolError('not_found', 'Verify this result against its source first', 404);
    await available(r, e.patient_id);
    if (e.result_reviewed_at) throw new ToolError('reviewed', 'Review already recorded');
    await r.db.query(
      'UPDATE clinical_entries SET result_reviewed_at=now(),result_reviewed_by=$2,result_review_note=$3 WHERE id=$1',
      [i.id, actor(r), i.note],
    );
    return { saved: true };
  },
});
const saveInsurance = defineTool({
  name: 'create_insurance_case',
  module: 'core',
  description: 'Track insurer paperwork locally; does not submit or decide coverage.',
  allow,
  input: z.object({
    patientId: UUID,
    title: text,
    assignedTo: UUID,
    dueAt: z.string().datetime(),
    documentId: UUID.optional(),
  }),
  auditInput: (i) => ({ patientId: i.patientId }),
  auditOutput: () => ({ created: true }),
  async run(r, i) {
    await available(r, i.patientId);
    if (
      !(
        await r.db.query("SELECT id FROM staff_users WHERE id=$1 AND role='doctor'", [i.assignedTo])
      ).rowCount
    )
      throw new ToolError('owner', 'Choose a clinic doctor');
    if (
      i.documentId &&
      !(
        await r.db.query('SELECT id FROM patient_documents WHERE id=$1 AND patient_id=$2', [
          i.documentId,
          i.patientId,
        ])
      ).rowCount
    )
      throw new ToolError('source', 'Choose a document belonging to this patient');
    return (
      await r.db.query(
        'INSERT INTO insurance_cases(clinic_id,patient_id,title,assigned_to,due_at,document_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
        [r.ctx.clinicId, i.patientId, i.title, i.assignedTo, i.dueAt, i.documentId ?? null],
      )
    ).rows[0];
  },
});
const updateInsurance = defineTool({
  name: 'update_insurance_case',
  module: 'core',
  description: 'Record actual insurer correspondence and local paperwork progress.',
  allow,
  input: z.object({
    id: UUID,
    status: z.enum(['submitted', 'more_information', 'approved', 'denied', 'closed', 'cancelled']),
    note: text,
  }),
  auditInput: (i) => ({ id: i.id, status: i.status }),
  auditOutput: () => ({ saved: true }),
  async run(r, i) {
    const c = (await r.db.query('SELECT * FROM insurance_cases WHERE id=$1 FOR UPDATE', [i.id]))
      .rows[0];
    if (!c) throw new ToolError('not_found', 'Case not found', 404);
    await available(r, c.patient_id);
    const next: Record<string, string[]> = {
      preparing: ['submitted', 'cancelled'],
      submitted: ['more_information', 'approved', 'denied', 'cancelled'],
      more_information: ['submitted', 'cancelled'],
      approved: ['closed'],
      denied: ['closed'],
    };
    if (!next[c.status]?.includes(i.status))
      throw new ToolError('transition', 'This change does not follow the paperwork sequence');
    await r.db.query('UPDATE insurance_cases SET status=$2,updated_at=now() WHERE id=$1', [
      i.id,
      i.status,
    ]);
    await r.db.query(
      'INSERT INTO insurance_case_history(clinic_id,case_id,status,note,recorded_by) VALUES($1,$2,$3,$4,$5)',
      [r.ctx.clinicId, i.id, i.status, i.note, actor(r)],
    );
    return { saved: true };
  },
});
export const localWorkflowTools = [
  templates,
  saveTemplate,
  reviewTemplate,
  applyTemplate,
  reviewResult,
  saveInsurance,
  updateInsurance,
];
const translationSource = defineTool({
  name: 'get_instruction_translation_source',
  module: 'core',
  description: 'Approved text eligible for a doctor-requested translation draft.',
  allow,
  input: z.object({ id: UUID }),
  auditOutput: () => ({ opened: true }),
  async run(r, i) {
    const s = (
      await r.db.query(
        "SELECT id,patient_id,note_id,body FROM patient_instructions WHERE id=$1 AND status='approved'",
        [i.id],
      )
    ).rows[0];
    if (!s) throw new ToolError('source', 'Choose approved instructions', 404);
    await available(r, s.patient_id);
    return s;
  },
});
const translationDraft = defineTool({
  name: 'save_instruction_translation_draft',
  module: 'core',
  description: 'Save a translation as an unapproved draft with the exact source preserved.',
  allow,
  input: z.object({
    sourceId: UUID,
    language: z.enum(['en', 'hi', 'hinglish', 'mr', 'bn', 'ta', 'te', 'kn', 'gu']),
    body: z.string().trim().min(1).max(20000),
  }),
  auditInput: (i) => ({ sourceId: i.sourceId, language: i.language }),
  auditOutput: () => ({ drafted: true }),
  async run(r, i) {
    const source = await translationSource.run(r, { id: i.sourceId });
    return (
      await r.db.query(
        'INSERT INTO patient_instructions(clinic_id,patient_id,note_id,language,body,created_by,translated_from,translation_source) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
        [
          r.ctx.clinicId,
          source.patient_id,
          source.note_id,
          i.language,
          i.body,
          actor(r),
          source.id,
          source.body,
        ],
      )
    ).rows[0];
  },
});
localWorkflowTools.push(translationSource as any, translationDraft as any);
const editPlanStep = defineTool({
  name: 'edit_draft_care_step',
  module: 'core',
  description: 'Tailor a draft template step to a patient before approval.',
  allow,
  input: z.object({ id: UUID, title: text, message: text, dueAt: z.string().datetime() }),
  auditInput: (i) => ({ id: i.id }),
  auditOutput: () => ({ saved: true }),
  async run(r, i) {
    const s = (
      await r.db.query(
        'SELECT s.patient_id,p.status FROM care_plan_steps s JOIN care_plans p ON p.id=s.plan_id WHERE s.id=$1 FOR UPDATE OF p,s',
        [i.id],
      )
    ).rows[0];
    if (!s || s.status !== 'draft') throw new ToolError('draft', 'Only a draft plan can be edited');
    await available(r, s.patient_id);
    await r.db.query('UPDATE care_plan_steps SET title=$2,message=$3,due_at=$4 WHERE id=$1', [
      i.id,
      i.title,
      i.message,
      i.dueAt,
    ]);
    return { saved: true };
  },
});
const dailyBrief = defineTool({
  name: 'get_daily_care_brief',
  module: 'core',
  description: 'Current clinic workload by recorded category; no inferred clinical priority.',
  allow,
  input: z.object({}),
  async run(r) {
    return (
      await r.db.query(`SELECT
 (SELECT count(*)::int FROM care_tasks WHERE status NOT IN ('informed','cancelled') AND kind='report') AS investigations,
 (SELECT count(*)::int FROM care_tasks WHERE status NOT IN ('informed','cancelled') AND kind='referral') AS referrals,
 (SELECT count(*)::int FROM insurance_cases WHERE status NOT IN ('closed','cancelled')) AS insurance,
 (SELECT count(*)::int FROM clinical_entries WHERE kind='lab' AND status='active' AND verified_at IS NOT NULL AND result_reviewed_at IS NULL AND ((data->>'value')::numeric<(data->>'low')::numeric OR (data->>'value')::numeric>(data->>'high')::numeric)) AS outside_range,
 (SELECT count(*)::int FROM care_plan_steps s JOIN care_plans p ON p.id=s.plan_id WHERE p.status='active' AND s.status NOT IN ('completed','cancelled') AND s.due_at <= now()+interval '24 hours') AS followups,
 (SELECT count(*)::int FROM care_plan_steps s JOIN care_plans p ON p.id=s.plan_id WHERE p.status='active' AND (s.status='no_response' OR (s.status='contacted' AND s.response_due_at<now()))) AS no_reply,
 (SELECT count(*)::int FROM conversations c WHERE handled_by='human' AND EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id=c.id AND m.direction='in' AND NOT EXISTS(SELECT 1 FROM messages x WHERE x.conversation_id=c.id AND x.direction='out' AND x.sender LIKE 'staff:%' AND x.created_at>=m.created_at))) AS messages,
 (SELECT count(*)::int FROM medical_references WHERE archived_at IS NULL AND review_due<current_date) AS references_due`)
    ).rows[0];
  },
});
localWorkflowTools.push(editPlanStep as any, dailyBrief as any);
