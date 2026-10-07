import { detectRedFlagKeywords } from '@sahayak/shared';
import { z } from 'zod';
import { defineTool, ToolError, type ToolRun } from './registry';
const UUID = z.string().uuid();
const text = z.string().trim().min(1).max(2000);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    'Enter a valid date',
  );
const DOCTOR = ['staff:doctor'];
const inputEntry = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('medication'),
    name: text,
    ingredient: text,
    dose: text,
    frequency: text,
    reason: z.string().max(2000).default(''),
  }),
  z.object({ kind: z.literal('allergy'), substance: text, reaction: text }),
  z.object({ kind: z.literal('diagnosis'), name: text, details: z.string().max(2000).default('') }),
  z.object({
    kind: z.literal('lab'),
    name: text,
    value: z.number().finite(),
    unit: text,
    low: z.number().finite().optional(),
    high: z.number().finite().optional(),
    sample: z.string().max(200).default(''),
    sourceText: text,
  }),
  z.object({ kind: z.literal('investigation'), name: text, details: text }),
  z.object({ kind: z.literal('referral'), name: text, details: text }),
  z.object({ kind: z.literal('insurance'), name: text, details: text }),
]);
function user(r: ToolRun) {
  if (r.ctx.actor.kind !== 'staff') throw new ToolError('forbidden', 'Doctor access required', 403);
  return r.ctx.actor.userId;
}
async function patient(r: ToolRun, id: string) {
  if (
    !(
      await r.db.query(
        "SELECT id FROM patients WHERE id=$1 AND name<>'Erased patient' AND erasure_requested_at IS NULL",
        [id],
      )
    ).rowCount
  )
    throw new ToolError('not_found', 'Patient is unavailable for new clinical work', 404);
}
async function assignee(r: ToolRun, id: string) {
  if (
    !(await r.db.query("SELECT id FROM staff_users WHERE id=$1 AND role='doctor'", [id])).rowCount
  )
    throw new ToolError('not_found', 'Choose a doctor in this clinic', 404);
}
const canonical = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
export function medicationWarnings(entries: any[]) {
  const meds = entries.filter(
    (e) => e.kind === 'medication' && e.status === 'active' && e.verified_at,
  );
  const allergies = entries.filter(
    (e) => e.kind === 'allergy' && e.status === 'active' && e.verified_at,
  );
  const warnings: { message: string; sourceIds: string[] }[] = [];
  for (let i = 0; i < meds.length; i++) {
    const m = meds[i];
    for (const a of allergies)
      if (canonical(m.data.ingredient) === canonical(a.data.substance))
        warnings.push({
          message: `Recorded allergy matches ${m.data.ingredient}. Review before prescribing.`,
          sourceIds: [m.id, a.id],
        });
    for (const other of meds.slice(i + 1))
      if (canonical(m.data.ingredient) === canonical(other.data.ingredient))
        warnings.push({
          message: `More than one active medicine contains ${m.data.ingredient}. Review for duplication.`,
          sourceIds: [m.id, other.id],
        });
  }
  return {
    warnings,
    limitations:
      'Checks only exact ingredient duplicates and exact recorded allergy matches in doctor-verified entries. It does not check interactions, dose suitability, drug classes, age, kidney/liver function, brand synonyms or missing allergies. No warnings does not mean a prescription is safe.',
  };
}
export const clinicalWorkspace = defineTool({
  name: 'get_clinical_workspace',
  module: 'core',
  description: 'Source-linked structured records, care plans and approved patient instructions.',
  allow: DOCTOR,
  input: z.object({ patientId: UUID }),
  auditOutput: () => ({ opened: true }),
  async run(r, i) {
    if (!(await r.db.query('SELECT id FROM patients WHERE id=$1', [i.patientId])).rowCount)
      throw new ToolError('not_found', 'Patient not found', 404);
    const entries = (
      await r.db.query(
        'SELECT e.*,e.occurred_on::text AS occurred_on,u.name AS recorder FROM clinical_entries e JOIN staff_users u ON u.id=e.recorded_by WHERE patient_id=$1 ORDER BY e.occurred_on DESC,e.created_at DESC',
        [i.patientId],
      )
    ).rows;
    const instructions = (
      await r.db.query(
        'SELECT * FROM patient_instructions WHERE patient_id=$1 ORDER BY created_at DESC',
        [i.patientId],
      )
    ).rows;
    const plans = (
      await r.db.query(
        'SELECT p.*,u.name AS assignee FROM care_plans p JOIN staff_users u ON u.id=p.assigned_to WHERE patient_id=$1 ORDER BY created_at DESC',
        [i.patientId],
      )
    ).rows;
    const steps = (
      await r.db.query('SELECT * FROM care_plan_steps WHERE patient_id=$1 ORDER BY due_at', [
        i.patientId,
      ])
    ).rows;
    const staff = (
      await r.db.query("SELECT id,name FROM staff_users WHERE role='doctor' ORDER BY name")
    ).rows;
    const history = (
      await r.db.query(
        `SELECT 'note' AS kind,id,signed_at AS at,'Signed visit note' AS title FROM visit_notes WHERE patient_id=$1 AND status='signed'
   UNION ALL SELECT 'document',id,created_at,filename FROM patient_documents WHERE patient_id=$1
   UNION ALL SELECT 'visit',id,checked_in_at,'Visit: '||status FROM queue_entries WHERE patient_id=$1 ORDER BY at DESC LIMIT 100`,
        [i.patientId],
      )
    ).rows;
    const stepHistory = (
      await r.db.query(
        'SELECT * FROM care_step_history WHERE patient_id=$1 ORDER BY created_at DESC',
        [i.patientId],
      )
    ).rows;
    const charges = (
      await r.db.query(
        `SELECT c.*,COALESCE((SELECT sum(p.amount_paise) FROM clinic_payments p WHERE p.charge_id=c.id AND p.voided_at IS NULL),0)::int AS paid FROM clinic_charges c WHERE patient_id=$1 ORDER BY created_at DESC`,
        [i.patientId],
      )
    ).rows;
    return {
      insurance: (
        await r.db.query(
          'SELECT c.*,u.name AS assignee FROM insurance_cases c JOIN staff_users u ON u.id=c.assigned_to WHERE patient_id=$1 ORDER BY due_at',
          [i.patientId],
        )
      ).rows,
      insuranceHistory: (
        await r.db.query(
          'SELECT h.* FROM insurance_case_history h JOIN insurance_cases c ON c.id=h.case_id WHERE c.patient_id=$1 ORDER BY h.created_at',
          [i.patientId],
        )
      ).rows,
      payments: (
        await r.db.query(
          'SELECT p.* FROM clinic_payments p JOIN clinic_charges c ON c.id=p.charge_id WHERE c.patient_id=$1 ORDER BY p.created_at DESC',
          [i.patientId],
        )
      ).rows,
      entries,
      instructions,
      plans,
      steps,
      staff,
      history,
      stepHistory,
      charges,
      safety: medicationWarnings(entries),
    };
  },
});
export const addClinicalEntry = defineTool({
  name: 'add_clinical_entry',
  module: 'core',
  description: 'Record doctor-entered clinical facts with source provenance.',
  allow: DOCTOR,
  input: z.object({
    patientId: UUID,
    occurredOn: date,
    documentId: UUID.optional(),
    data: inputEntry,
    verified: z.boolean(),
  }),
  auditInput: (i) => ({ patientId: i.patientId, kind: i.data.kind }),
  auditOutput: () => ({ saved: true }),
  async run(r, i) {
    await patient(r, i.patientId);
    if (
      i.documentId &&
      !(
        await r.db.query('SELECT id FROM patient_documents WHERE id=$1 AND patient_id=$2', [
          i.documentId,
          i.patientId,
        ])
      ).rowCount
    )
      throw new ToolError('wrong_source', 'Choose a report belonging to this patient');
    if (i.data.kind === 'lab' && !i.documentId)
      throw new ToolError('source_required', 'Link the uploaded report before saving a result');
    if (
      i.data.kind === 'lab' &&
      i.data.low !== undefined &&
      i.data.high !== undefined &&
      i.data.low > i.data.high
    )
      throw new ToolError('range', 'Reference range is reversed');
    return (
      await r.db.query(
        `INSERT INTO clinical_entries(clinic_id,patient_id,kind,data,document_id,recorded_by,occurred_on,verified_at,verified_by) VALUES ($1,$2,$3,$4,$5,$6,$7,CASE WHEN $8 THEN now() ELSE NULL END,CASE WHEN $8 THEN $6::uuid ELSE NULL END) RETURNING id`,
        [
          r.ctx.clinicId,
          i.patientId,
          i.data.kind,
          i.data,
          i.documentId ?? null,
          user(r),
          i.occurredOn,
          i.verified,
        ],
      )
    ).rows[0];
  },
});
export const updateClinicalEntry = defineTool({
  name: 'update_clinical_entry',
  module: 'core',
  description: 'Verify or close an existing fact without rewriting its source.',
  allow: DOCTOR,
  input: z.object({
    id: UUID,
    status: z.enum(['active', 'completed', 'stopped', 'entered_in_error']).optional(),
    verify: z.boolean().optional(),
  }),
  async run(r, i) {
    const row = (await r.db.query('SELECT * FROM clinical_entries WHERE id=$1 FOR UPDATE', [i.id]))
      .rows[0];
    if (!row) throw new ToolError('not_found', 'Record not found', 404);
    await patient(r, row.patient_id);
    await r.db.query(
      'UPDATE clinical_entries SET status=COALESCE($2,status),verified_at=CASE WHEN $3 THEN COALESCE(verified_at,now()) ELSE verified_at END,verified_by=CASE WHEN $3 THEN COALESCE(verified_by,$4) ELSE verified_by END,updated_at=now() WHERE id=$1',
      [i.id, i.status ?? null, i.verify ?? false, user(r)],
    );
    return { saved: true };
  },
});
export const draftInstructions = defineTool({
  name: 'draft_patient_instructions',
  module: 'core',
  description: 'Copy approved source note sections into a reviewable instruction draft.',
  allow: DOCTOR,
  input: z.object({ patientId: UUID, noteId: UUID, language: z.enum(['en', 'hi']).default('en') }),
  auditOutput: () => ({ drafted: true }),
  async run(r, i) {
    await patient(r, i.patientId);
    const note = (
      await r.db.query(
        "SELECT note FROM visit_notes WHERE id=$1 AND patient_id=$2 AND status='signed'",
        [i.noteId, i.patientId],
      )
    ).rows[0];
    if (!note) throw new ToolError('source', 'Choose a signed note for this patient');
    const fields = ['plan', 'investigations', 'follow_up', 'instructions'];
    const labels =
      i.language === 'hi'
        ? ['डॉक्टर की योजना', 'जांच', 'अगली मुलाकात', 'निर्देश']
        : ['Doctor’s plan', 'Requested tests', 'Follow-up', 'Instructions'];
    const body = fields
      .map((f, n) => (note.note[f] ? `${labels[n]}\n${note.note[f]}` : ''))
      .filter(Boolean)
      .join('\n\n');
    if (!body) throw new ToolError('empty', 'The signed note has no plan or instructions to copy');
    return (
      await r.db.query(
        'INSERT INTO patient_instructions(clinic_id,patient_id,note_id,language,body,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [r.ctx.clinicId, i.patientId, i.noteId, i.language, body, user(r)],
      )
    ).rows[0];
  },
});
export const approveInstructions = defineTool({
  name: 'save_patient_instructions',
  module: 'core',
  description: 'Doctor edits and optionally approves patient instructions.',
  allow: DOCTOR,
  input: z.object({ id: UUID, body: z.string().trim().min(1).max(20000), approve: z.boolean() }),
  auditInput: (i) => ({ id: i.id, approve: i.approve }),
  auditOutput: () => ({ saved: true }),
  async run(r, i) {
    const row = (
      await r.db.query('SELECT * FROM patient_instructions WHERE id=$1 FOR UPDATE', [i.id])
    ).rows[0];
    if (!row || row.status !== 'draft')
      throw new ToolError('locked', 'Only draft instructions can be changed');
    await patient(r, row.patient_id);
    await r.db.query(
      "UPDATE patient_instructions SET body=$2,status=$3,approved_by=$4,approved_at=CASE WHEN $3='approved' THEN now() ELSE NULL END WHERE id=$1",
      [i.id, i.body, i.approve ? 'approved' : 'draft', i.approve ? user(r) : null],
    );
    return { saved: true };
  },
});
export const createCarePlan = defineTool({
  name: 'create_care_plan',
  module: 'core',
  description: 'Prepare a doctor-reviewed sequence of follow-up tasks; no automatic delivery.',
  allow: DOCTOR,
  input: z.object({
    patientId: UUID,
    title: text,
    assignedTo: UUID,
    steps: z
      .array(z.object({ title: text, message: text, dueAt: z.string().datetime() }))
      .min(1)
      .max(12),
  }),
  auditInput: (i) => ({ patientId: i.patientId, steps: i.steps.length }),
  auditOutput: () => ({ drafted: true }),
  async run(r, i) {
    await patient(r, i.patientId);
    await assignee(r, i.assignedTo);
    const id = (
      await r.db.query(
        'INSERT INTO care_plans(clinic_id,patient_id,title,assigned_to,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [r.ctx.clinicId, i.patientId, i.title, i.assignedTo, user(r)],
      )
    ).rows[0].id;
    for (const s of i.steps)
      await r.db.query(
        'INSERT INTO care_plan_steps(clinic_id,plan_id,patient_id,title,message,due_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [r.ctx.clinicId, id, i.patientId, s.title, s.message, s.dueAt],
      );
    return { id };
  },
});
export const changeCarePlan = defineTool({
  name: 'change_care_plan',
  module: 'core',
  description: 'Approve, pause, resume or cancel a follow-up plan.',
  allow: DOCTOR,
  input: z.object({ id: UUID, status: z.enum(['active', 'paused', 'cancelled', 'completed']) }),
  async run(r, i) {
    const p = (await r.db.query('SELECT * FROM care_plans WHERE id=$1 FOR UPDATE', [i.id])).rows[0];
    if (!p) throw new ToolError('not_found', 'Plan not found', 404);
    await patient(r, p.patient_id);
    if (['cancelled', 'completed'].includes(p.status))
      throw new ToolError('closed', 'This plan is already closed');
    if (i.status === 'paused' && p.status !== 'active')
      throw new ToolError('transition', 'Only an active plan can be paused');
    if (
      i.status === 'completed' &&
      (
        await r.db.query(
          "SELECT id FROM care_plan_steps WHERE plan_id=$1 AND status NOT IN ('completed','cancelled')",
          [i.id],
        )
      ).rowCount
    )
      throw new ToolError('incomplete', 'Complete or cancel each step before closing the plan');
    await r.db.query(
      "UPDATE care_plans SET status=$2,approved_at=CASE WHEN $2='active' THEN COALESCE(approved_at,now()) ELSE approved_at END WHERE id=$1",
      [i.id, i.status],
    );
    if (i.status === 'cancelled')
      await r.db.query(
        "UPDATE care_plan_steps SET status='cancelled' WHERE plan_id=$1 AND status NOT IN ('completed','cancelled')",
        [i.id],
      );
    return { saved: true };
  },
});
export const updateCareStep = defineTool({
  name: 'update_care_step',
  module: 'core',
  description: 'Record completed outreach or a patient reply and doctor review.',
  allow: DOCTOR,
  input: z.object({
    id: UUID,
    status: z.enum(['contacted', 'no_response', 'completed', 'needs_review', 'cancelled']),
    responseDueAt: z.string().datetime().optional(),
    response: z.string().trim().max(2000).optional(),
  }),
  auditInput: (i) => ({ id: i.id, status: i.status }),
  auditOutput: () => ({ saved: true }),
  async run(r, i) {
    const s = (
      await r.db.query(
        'SELECT s.*,p.status AS plan_status FROM care_plan_steps s JOIN care_plans p ON p.id=s.plan_id WHERE s.id=$1 FOR UPDATE OF p,s',
        [i.id],
      )
    ).rows[0];
    if (!s) throw new ToolError('not_found', 'Step not found', 404);
    await patient(r, s.patient_id);
    if (s.plan_status !== 'active')
      throw new ToolError('paused', 'Approve or resume this plan first');
    if (['completed', 'cancelled'].includes(s.status))
      throw new ToolError('closed', 'Step is already closed');
    if (i.status === 'contacted' && !['pending', 'no_response'].includes(s.status))
      throw new ToolError('transition', 'Outreach was already recorded');
    if (i.status === 'completed' && !i.response?.trim())
      throw new ToolError('review_required', 'Record your review or the completed outcome');
    if (
      i.status === 'no_response' &&
      (s.status !== 'contacted' ||
        !s.response_due_at ||
        new Date(s.response_due_at).getTime() > Date.now())
    )
      throw new ToolError('reply_not_due', 'A reply is not overdue yet');
    if (i.status === 'contacted' && i.responseDueAt && Date.parse(i.responseDueAt) <= Date.now())
      throw new ToolError('deadline', 'Choose a future reply deadline');
    const extra = (await r.db.query('SELECT phrase,language FROM red_flag_phrases')).rows;
    const urgent = i.response ? detectRedFlagKeywords(i.response, extra) : null;
    let status = i.status;
    if (urgent) {
      status = 'needs_review';
      if (
        !s.flag_id ||
        !(await r.db.query("SELECT id FROM flags WHERE id=$1 AND status='open'", [s.flag_id]))
          .rowCount
      ) {
        const flag = (
          await r.db.query(
            "INSERT INTO flags(clinic_id,patient_id,kind,severity,summary) VALUES ($1,$2,'red_flag','urgent','A recorded follow-up response contains an emergency phrase. Review the patient and follow-up history promptly.') RETURNING id",
            [r.ctx.clinicId, s.patient_id],
          )
        ).rows[0].id;
        await r.db.query('UPDATE care_plan_steps SET flag_id=$2 WHERE id=$1', [s.id, flag]);
        r.emit({ type: 'flag_raised', flagId: flag, severity: 'urgent' });
      }
    }
    if (
      status === 'completed' &&
      s.flag_id &&
      (await r.db.query("SELECT id FROM flags WHERE id=$1 AND status='open'", [s.flag_id])).rowCount
    )
      throw new ToolError(
        'urgent_open',
        'Review and resolve the urgent alert before completing this step',
      );
    await r.db.query(
      'INSERT INTO care_step_history(clinic_id,patient_id,step_id,status,response,recorded_by) VALUES ($1,$2,$3,$4,$5,$6)',
      [r.ctx.clinicId, s.patient_id, s.id, status, i.response ?? null, user(r)],
    );
    await r.db.query(
      "UPDATE care_plan_steps SET status=$2,response=COALESCE($3,response),contacted_at=CASE WHEN $2='contacted' THEN now() ELSE contacted_at END,responded_at=CASE WHEN $3 IS NOT NULL THEN now() ELSE responded_at END WHERE id=$1",
      [i.id, status, i.response ?? null],
    );
    if (i.status === 'contacted')
      await r.db.query('UPDATE care_plan_steps SET response_due_at=$2 WHERE id=$1', [
        i.id,
        i.responseDueAt ?? new Date(Date.now() + 2 * 86400000).toISOString(),
      ]);
    return { saved: true, urgent: !!urgent };
  },
});
export const referenceLibrary = defineTool({
  name: 'list_medical_references',
  module: 'core',
  description: 'Clinic-reviewed reference library; not a live guideline search.',
  allow: DOCTOR,
  input: z.object({}),
  auditOutput: (o: any) => ({ count: o.references.length }),
  async run({ db }) {
    return {
      references: (
        await db.query(
          'SELECT r.*,r.published_on::text AS published_on,r.review_due::text AS review_due,u.name AS reviewer FROM medical_references r JOIN staff_users u ON u.id=r.reviewed_by WHERE r.archived_at IS NULL ORDER BY r.review_due,r.title',
        )
      ).rows,
    };
  },
});
export const saveReference = defineTool({
  name: 'save_medical_reference',
  module: 'core',
  description: 'Save a clinician-reviewed external source without patient information.',
  allow: DOCTOR,
  input: z.object({
    id: UUID.optional(),
    title: text,
    url: z
      .string()
      .url()
      .refine((v) => v.startsWith('https://'), 'Use an HTTPS link'),
    publishedOn: date,
    reviewDue: date,
    notes: text,
  }),
  auditInput: () => ({ reference: true }),
  auditOutput: () => ({ saved: true }),
  async run(r, i) {
    if (i.id) {
      const result = await r.db.query(
        'UPDATE medical_references SET title=$2,url=$3,published_on=$4,review_due=$5,notes=$6,reviewed_by=$7,reviewed_at=now() WHERE id=$1 AND archived_at IS NULL RETURNING id',
        [i.id, i.title, i.url, i.publishedOn, i.reviewDue, i.notes, user(r)],
      );
      if (!result.rowCount) throw new ToolError('not_found', 'Reference not found', 404);
      return result.rows[0];
    }
    return (
      await r.db.query(
        'INSERT INTO medical_references(clinic_id,title,url,published_on,review_due,notes,reviewed_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [r.ctx.clinicId, i.title, i.url, i.publishedOn, i.reviewDue, i.notes, user(r)],
      )
    ).rows[0];
  },
});
export const practiceOverview = defineTool({
  name: 'get_practice_overview',
  module: 'core',
  description:
    'Measured workload and completion counts without invented financial or time-saving estimates.',
  allow: DOCTOR,
  input: z.object({ days: z.number().int().min(1).max(365).default(30) }),
  async run({ db }, i) {
    const since = new Date(Date.now() - i.days * 86400000).toISOString();
    return {
      visits: (
        await db.query(
          'SELECT status,count(*)::int AS count FROM queue_entries WHERE checked_in_at >= $1 GROUP BY status',
          [since],
        )
      ).rows,
      appointments: (
        await db.query(
          'SELECT status,count(*)::int AS count FROM appointments WHERE starts_at >= $1 AND starts_at <= now() GROUP BY status',
          [since],
        )
      ).rows,
      tasks: (
        await db.query(
          'SELECT kind,status,count(*)::int AS count FROM care_tasks WHERE created_at >= $1 GROUP BY kind,status',
          [since],
        )
      ).rows,
      notes: (
        await db.query(
          "SELECT count(*)::int AS count FROM visit_notes WHERE status='signed' AND signed_at >= $1",
          [since],
        )
      ).rows[0].count,
      steps: (
        await db.query(
          'SELECT status,count(*)::int AS count FROM care_plan_steps WHERE due_at >= $1 AND due_at <= now() GROUP BY status',
          [since],
        )
      ).rows,
      reportsWaiting: (
        await db.query("SELECT count(*)::int AS count FROM patient_documents WHERE status='new'")
      ).rows[0].count,
      urgent: (
        await db.query(
          "SELECT count(*)::int AS count FROM flags WHERE status='open' AND severity='urgent'",
        )
      ).rows[0].count,
      finances: (
        await db.query(
          `SELECT (SELECT COALESCE(sum(amount_paise),0) FROM clinic_payments WHERE created_at >= $1 AND voided_at IS NULL AND NOT is_test)::bigint AS collected, (SELECT COALESCE(sum(c.amount_paise-COALESCE((SELECT sum(p.amount_paise) FROM clinic_payments p WHERE p.charge_id=c.id AND p.voided_at IS NULL),0)),0) FROM clinic_charges c WHERE status='open' AND NOT c.is_test)::bigint AS outstanding`,
          [since],
        )
      ).rows[0],
      measures: (
        await db.query(
          `SELECT
        (SELECT count(*)::int FROM appointments WHERE starts_at >= $1 AND starts_at<=now() AND status='no_show') AS no_shows,
        (SELECT count(*)::int FROM appointments WHERE starts_at >= $1 AND starts_at<=now() AND status IN ('no_show','checked_in','completed')) AS attendance_known,
        (SELECT count(*)::int FROM care_tasks WHERE created_at >= $1 AND kind='referral' AND status='informed') AS referrals_complete,
        (SELECT count(*)::int FROM care_tasks WHERE created_at >= $1 AND kind='referral' AND status<>'cancelled') AS referrals_total,
        (SELECT count(*)::int FROM care_plan_steps WHERE due_at >= $1 AND due_at<=now() AND status='completed') AS followups_complete,
        (SELECT count(*)::int FROM care_plan_steps s JOIN care_plans p ON p.id=s.plan_id WHERE s.due_at >= $1 AND s.due_at<=now() AND s.status<>'cancelled' AND p.approved_at IS NOT NULL) AS followups_total,
        (SELECT round(avg(extract(epoch FROM finished_at-consultation_started_at)/60)::numeric,1) FROM queue_entries WHERE finished_at >= $1 AND status='done' AND consultation_started_at IS NOT NULL AND finished_at>=consultation_started_at) AS consultation_minutes,
        (SELECT count(*)::int FROM queue_entries WHERE finished_at >= $1 AND status='done' AND consultation_started_at IS NOT NULL AND finished_at>=consultation_started_at) AS timed_visits,
        (SELECT round(sum(p.amount_paise)::numeric/NULLIF(count(DISTINCT c.patient_id),0)/100,2) FROM clinic_payments p JOIN clinic_charges c ON c.id=p.charge_id WHERE p.created_at >= $1 AND p.voided_at IS NULL AND NOT p.is_test AND c.patient_id IS NOT NULL) AS collected_per_paying_patient`,
          [since],
        )
      ).rows[0],
      patientActivity: (
        await db.query(
          `WITH seen AS (SELECT DISTINCT patient_id FROM queue_entries WHERE checked_in_at >= $1 AND status='done')
        SELECT count(*)::int AS total,count(*) FILTER (WHERE EXISTS(SELECT 1 FROM queue_entries old WHERE old.patient_id=seen.patient_id AND old.status='done' AND old.checked_in_at < $1))::int AS returning FROM seen`,
          [since],
        )
      ).rows[0],
      dailyVisits: (
        await db.query(
          "SELECT queue_date::text AS day,count(*)::int AS count FROM queue_entries WHERE checked_in_at >= $1 AND status='done' GROUP BY queue_date ORDER BY queue_date",
          [since],
        )
      ).rows,
      days: i.days,
    };
  },
});
export const workbenchTools = [
  clinicalWorkspace,
  addClinicalEntry,
  updateClinicalEntry,
  draftInstructions,
  approveInstructions,
  createCarePlan,
  changeCarePlan,
  updateCareStep,
  referenceLibrary,
  saveReference,
  practiceOverview,
];

export function parseReportRows(source: string) {
  const lines = source
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (!lines.length || lines.length > 100)
    throw new ToolError('rows', 'Paste 1 to 100 tab-separated result rows');
  return lines.map((line, n) => {
    const columns = line.split('\t').map((v) => v.trim());
    if (columns.length < 3 || columns.length > 6)
      throw new ToolError(
        'format',
        `Row ${n + 1}: use test name, value, unit, optional lower/upper limit and sample, separated by tabs`,
      );
    const [name, raw, unit, low, high, sample] = columns;
    const number = (v: string) => {
      if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(v) || !Number.isFinite(Number(v)))
        throw new ToolError(
          'number',
          `Row ${n + 1}: only plain numeric values are supported; enter ranges and qualitative results separately`,
        );
      return Number(v);
    };
    const data = {
      kind: 'lab' as const,
      name,
      value: number(raw),
      unit,
      low: low ? number(low) : undefined,
      high: high ? number(high) : undefined,
      sample: sample ?? '',
      sourceText: line,
    };
    if (
      !name ||
      !unit ||
      (data.low !== undefined && data.high !== undefined && data.low > data.high)
    )
      throw new ToolError(
        'format',
        `Row ${n + 1}: name, unit and ordered reference limits are required`,
      );
    return inputEntry.parse(data) as typeof data;
  });
}
export const importReportRows = defineTool({
  name: 'import_report_rows',
  module: 'core',
  description:
    'Import pasted numeric report rows as unverified entries, preserving exact source text.',
  allow: DOCTOR,
  input: z.object({
    patientId: UUID,
    documentId: UUID,
    occurredOn: date,
    source: z.string().min(1).max(30000),
  }),
  auditInput: (i) => ({ patientId: i.patientId, documentId: i.documentId }),
  auditOutput: (o: any) => ({ count: o.count }),
  async run(r, i) {
    const rows = parseReportRows(i.source);
    for (const data of rows)
      await addClinicalEntry.run(r, {
        patientId: i.patientId,
        documentId: i.documentId,
        occurredOn: i.occurredOn,
        data,
        verified: false,
      });
    return { count: rows.length };
  },
});
export const addCharge = defineTool({
  name: 'add_clinic_charge',
  module: 'core',
  description: 'Record a clinic charge, without collecting money.',
  allow: DOCTOR,
  input: z.object({
    patientId: UUID,
    description: text,
    amountPaise: z.number().int().min(1).max(100000000),
  }),
  auditInput: (i) => ({ patientId: i.patientId, amountPaise: i.amountPaise }),
  async run(r, i) {
    await patient(r, i.patientId);
    return (
      await r.db.query(
        'INSERT INTO clinic_charges(clinic_id,patient_id,description,amount_paise,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [r.ctx.clinicId, i.patientId, i.description, i.amountPaise, user(r)],
      )
    ).rows[0];
  },
});
export const recordPayment = defineTool({
  name: 'record_clinic_payment',
  module: 'core',
  description: 'Record money already received; no payment is initiated.',
  allow: DOCTOR,
  input: z.object({
    chargeId: UUID,
    requestId: UUID,
    amountPaise: z.number().int().min(1).max(100000000),
    method: z.enum(['cash', 'card', 'upi', 'bank', 'other']),
  }),
  async run(r, i) {
    const charge = (
      await r.db.query('SELECT * FROM clinic_charges WHERE id=$1 FOR UPDATE', [i.chargeId])
    ).rows[0];
    if (!charge || charge.status !== 'open')
      throw new ToolError('not_found', 'Open charge not found', 404);
    const repeat = (
      await r.db.query('SELECT * FROM clinic_payments WHERE request_id=$1', [i.requestId])
    ).rows[0];
    if (repeat) {
      if (repeat.voided_at)
        throw new ToolError(
          'voided',
          'This payment entry was corrected. Create a new entry for the actual payment.',
        );
      if (
        repeat.charge_id !== i.chargeId ||
        repeat.amount_paise !== i.amountPaise ||
        repeat.method !== i.method
      )
        throw new ToolError('conflict', 'Payment reference already used for different details');
      return { saved: true };
    }
    const paid = Number(
      (
        await r.db.query(
          'SELECT COALESCE(sum(amount_paise),0) AS paid FROM clinic_payments WHERE charge_id=$1 AND voided_at IS NULL',
          [i.chargeId],
        )
      ).rows[0].paid,
    );
    if (paid + i.amountPaise > charge.amount_paise)
      throw new ToolError('amount', 'Recorded payment exceeds the outstanding amount');
    await r.db.query(
      'INSERT INTO clinic_payments(clinic_id,charge_id,request_id,amount_paise,method,recorded_by,is_test) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [r.ctx.clinicId, i.chargeId, i.requestId, i.amountPaise, i.method, user(r), charge.is_test],
    );
    return { saved: true };
  },
});
workbenchTools.push(importReportRows as any, addCharge as any, recordPayment as any);

export const correctBilling = defineTool({
  name: 'correct_clinic_billing',
  module: 'core',
  description: 'Correct a mistaken entry without deleting its history or initiating a refund.',
  allow: DOCTOR,
  input: z.object({
    chargeId: UUID,
    paymentId: UUID.optional(),
    reason: z.enum(['duplicate', 'incorrect_amount', 'incorrect_method', 'entered_in_error']),
  }),
  async run(r, i) {
    const c = (
      await r.db.query('SELECT * FROM clinic_charges WHERE id=$1 FOR UPDATE', [i.chargeId])
    ).rows[0];
    if (!c) throw new ToolError('not_found', 'Charge not found', 404);
    if (i.paymentId) {
      const changed = await r.db.query(
        'UPDATE clinic_payments SET voided_at=COALESCE(voided_at,now()),voided_by=COALESCE(voided_by,$3),correction_reason=COALESCE(correction_reason,$4) WHERE id=$1 AND charge_id=$2 RETURNING id',
        [i.paymentId, i.chargeId, user(r), i.reason],
      );
      if (!changed.rowCount) throw new ToolError('not_found', 'Payment entry not found', 404);
    } else {
      if (
        (
          await r.db.query(
            'SELECT id FROM clinic_payments WHERE charge_id=$1 AND voided_at IS NULL',
            [i.chargeId],
          )
        ).rowCount
      )
        throw new ToolError(
          'paid',
          'Correct any mistaken payment entries before cancelling this charge. Actual refunds must be handled outside Sahayak.',
        );
      await r.db.query(
        "UPDATE clinic_charges SET status='cancelled',cancelled_at=COALESCE(cancelled_at,now()),cancelled_by=COALESCE(cancelled_by,$2) WHERE id=$1",
        [i.chargeId, user(r)],
      );
    }
    return { saved: true };
  },
});
export const archiveReference = defineTool({
  name: 'archive_medical_reference',
  module: 'core',
  description: 'Remove a reference from the active clinic reading list while retaining its record.',
  allow: DOCTOR,
  input: z.object({ id: UUID }),
  async run(r, i) {
    if (
      !(
        await r.db.query(
          'UPDATE medical_references SET archived_at=COALESCE(archived_at,now()) WHERE id=$1 RETURNING id',
          [i.id],
        )
      ).rowCount
    )
      throw new ToolError('not_found', 'Reference not found', 404);
    return { saved: true };
  },
});
workbenchTools.push(correctBilling as any, archiveReference as any);
