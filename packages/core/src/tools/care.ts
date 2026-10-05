import { z } from 'zod';
import { defineTool, ToolError } from './registry';
const UUID = z.string().uuid();
const DOCTOR = ['staff:doctor'];
const STAFF = [...DOCTOR, 'staff:receptionist'];
const kind = z.enum(['report', 'referral', 'document', 'followup', 'instructions']);

export const previsitBrief = defineTool({
  name: 'get_previsit_brief',
  description: 'Source-linked excerpts for doctor review; no inferred clinical conclusions.',
  module: 'core',
  input: z.object({ patientId: UUID }),
  allow: DOCTOR,
  auditInput: (i) => ({ patientId: i.patientId }),
  auditOutput: () => ({ opened: true }),
  async run({ db }, { patientId }) {
    if (!(await db.query('SELECT 1 FROM patients WHERE id=$1', [patientId])).rowCount)
      throw new ToolError('not_found', 'Patient not found', 404);
    const concerns = (
      await db.query(
        `SELECT id,reason,starts_at,status FROM appointments WHERE patient_id=$1 AND reason IS NOT NULL ORDER BY starts_at DESC LIMIT 5`,
        [patientId],
      )
    ).rows;
    const intake = (
      await db.query(
        'SELECT id,queue_entry_id,answers,summary,created_at FROM intake_summaries WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 5',
        [patientId],
      )
    ).rows;
    const notes = (
      await db.query(
        `SELECT n.id,n.note,n.signed_at,d.name AS doctor FROM visit_notes n JOIN doctors d ON d.id=n.doctor_id WHERE n.patient_id=$1 AND n.status='signed' ORDER BY n.signed_at DESC LIMIT 5`,
        [patientId],
      )
    ).rows;
    const documents = (
      await db.query(
        'SELECT id,filename,caption,status,created_at FROM patient_documents WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 10',
        [patientId],
      )
    ).rows;
    const visits = (
      await db.query(
        'SELECT id,queue_date::text,status,token_number FROM queue_entries WHERE patient_id=$1 ORDER BY queue_date DESC,token_number DESC LIMIT 5',
        [patientId],
      )
    ).rows;
    const structured = (
      await db.query(
        "SELECT id,kind,data,occurred_on::text,document_id FROM clinical_entries WHERE patient_id=$1 AND verified_at IS NOT NULL AND status='active' ORDER BY occurred_on DESC,created_at DESC",
        [patientId],
      )
    ).rows;
    const pending = (
      await db.query(
        "SELECT id,title,kind,due_at FROM care_tasks WHERE patient_id=$1 AND status NOT IN ('informed','cancelled') ORDER BY due_at",
        [patientId],
      )
    ).rows;
    return {
      labComparisons: structured
        .filter((e: any) => e.kind === 'lab')
        .map((e: any) => ({
          current: e,
          previous:
            structured.find(
              (p: any) =>
                p.kind === 'lab' &&
                p.data.name.toLowerCase() === e.data.name.toLowerCase() &&
                p.data.unit === e.data.unit &&
                p.data.sample === e.data.sample &&
                p.occurred_on < e.occurred_on,
            ) ?? null,
        }))
        .filter(
          (pair: any, n: number, list: any[]) =>
            list.findIndex(
              (x) =>
                x.current.data.name.toLowerCase() === pair.current.data.name.toLowerCase() &&
                x.current.data.unit === pair.current.data.unit &&
                x.current.data.sample === pair.current.data.sample,
            ) === n,
        ),
      structured,
      pending,
      concerns,
      intake,
      notes,
      documents,
      visits,
      generatedAt: new Date().toISOString(),
    };
  },
});
export const listCareTasks = defineTool({
  name: 'list_care_tasks',
  description: 'Assigned clinical follow-through tasks.',
  module: 'core',
  input: z.object({ patientId: UUID.optional() }),
  allow: DOCTOR,
  auditInput: (i) => ({ patientId: i.patientId }),
  auditOutput: (o: any) => ({ count: o.tasks.length }),
  async run({ db }, i) {
    return {
      tasks: (
        await db.query(
          `SELECT t.*,p.name AS patient_name,u.name AS assignee,
    (t.due_at<now() AND t.status NOT IN ('informed','cancelled')) AS overdue
    FROM care_tasks t JOIN patients p ON p.id=t.patient_id LEFT JOIN staff_users u ON u.id=t.assigned_to
    WHERE ($1::uuid IS NULL OR t.patient_id=$1) ORDER BY (t.status NOT IN ('informed','cancelled')) DESC,t.due_at LIMIT 200`,
          [i.patientId ?? null],
        )
      ).rows,
      staff: (
        await db.query("SELECT id,name,role FROM staff_users WHERE role='doctor' ORDER BY name")
      ).rows,
    };
  },
});
export const createCareTask = defineTool({
  name: 'create_care_task',
  description: 'Doctor requests a report, referral, document, follow-up or instruction review.',
  module: 'core',
  input: z.object({
    patientId: UUID,
    queueEntryId: UUID.optional(),
    kind,
    title: z.string().trim().min(3).max(200),
    assignedTo: UUID,
    dueAt: z.string().datetime(),
  }),
  allow: DOCTOR,
  auditInput: (i) => ({ patientId: i.patientId, kind: i.kind }),
  async run({ db, ctx }, i) {
    if (
      !(
        await db.query("SELECT 1 FROM patients WHERE id=$1 AND name<>'Erased patient'", [
          i.patientId,
        ])
      ).rowCount
    )
      throw new ToolError('not_found', 'Patient not found', 404);
    if (
      !(await db.query("SELECT 1 FROM staff_users WHERE id=$1 AND role='doctor'", [i.assignedTo]))
        .rowCount
    )
      throw new ToolError('not_found', 'Assigned doctor not found', 404);
    if (
      i.queueEntryId &&
      !(
        await db.query('SELECT 1 FROM queue_entries WHERE id=$1 AND patient_id=$2', [
          i.queueEntryId,
          i.patientId,
        ])
      ).rowCount
    )
      throw new ToolError('wrong_visit', 'Visit does not belong to this patient');
    const row = (
      await db.query(
        `INSERT INTO care_tasks(clinic_id,patient_id,queue_entry_id,kind,title,assigned_to,due_at,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [
          ctx.clinicId,
          i.patientId,
          i.queueEntryId ?? null,
          i.kind,
          i.title,
          i.assignedTo,
          i.dueAt,
          ctx.actor.kind === 'staff' ? ctx.actor.userId : null,
        ],
      )
    ).rows[0];
    return { taskId: row.id };
  },
});
export const updateCareTask = defineTool({
  name: 'update_care_task',
  description: 'Advance a task with doctor review before recording patient communication.',
  module: 'core',
  input: z.object({
    taskId: UUID,
    status: z.enum(['received', 'reviewed', 'informed', 'cancelled']).optional(),
    documentId: UUID.optional(),
    assignedTo: UUID.optional(),
    dueAt: z.string().datetime().optional(),
  }),
  allow: DOCTOR,
  auditInput: (i) => ({ taskId: i.taskId, status: i.status }),
  async run({ db, ctx }, i) {
    const task = (await db.query('SELECT * FROM care_tasks WHERE id=$1 FOR UPDATE', [i.taskId]))
      .rows[0];
    if (!task) throw new ToolError('not_found', 'Task not found', 404);
    if (['informed', 'cancelled'].includes(task.status))
      throw new ToolError('closed', 'This task is closed');
    const next: Record<string, string> = {
      requested: 'received',
      received: 'reviewed',
      reviewed: 'informed',
    };
    if (i.status && i.status !== 'cancelled' && next[task.status] !== i.status)
      throw new ToolError(
        'invalid_transition',
        'Receive, review, then record patient communication in order',
      );
    if (
      i.assignedTo &&
      !(await db.query("SELECT 1 FROM staff_users WHERE id=$1 AND role='doctor'", [i.assignedTo]))
        .rowCount
    )
      throw new ToolError('not_found', 'Assigned doctor not found', 404);
    if (
      i.documentId &&
      !(
        await db.query('SELECT 1 FROM patient_documents WHERE id=$1 AND patient_id=$2', [
          i.documentId,
          task.patient_id,
        ])
      ).rowCount
    )
      throw new ToolError('wrong_document', 'Document does not belong to this patient');
    if (task.kind === 'report' && i.status === 'received' && !i.documentId && !task.document_id)
      throw new ToolError(
        'missing_report',
        'Attach the uploaded report before marking it received',
      );
    await db.query(
      `UPDATE care_tasks SET status=COALESCE($2,status),document_id=COALESCE($3,document_id),assigned_to=COALESCE($4,assigned_to),due_at=COALESCE($5,due_at),
      reviewed_by=CASE WHEN $2='reviewed' THEN $6 ELSE reviewed_by END,reviewed_at=CASE WHEN $2='reviewed' THEN now() ELSE reviewed_at END,
      informed_at=CASE WHEN $2='informed' THEN now() ELSE informed_at END,updated_at=now() WHERE id=$1`,
      [
        i.taskId,
        i.status ?? null,
        i.documentId ?? null,
        i.assignedTo ?? null,
        i.dueAt ?? null,
        ctx.actor.kind === 'staff' ? ctx.actor.userId : null,
      ],
    );
    return { ok: true };
  },
});
export const visitChecklist = defineTool({
  name: 'get_visit_checklist',
  description: 'Review outstanding documentation and follow-through before finishing a visit.',
  module: 'core',
  input: z.object({ queueEntryId: UUID }),
  allow: STAFF,
  auditInput: (i) => i,
  auditOutput: () => ({ opened: true }),
  async run({ db, ctx }, { queueEntryId }) {
    const visit = (
      await db.query('SELECT id,patient_id,doctor_id,status FROM queue_entries WHERE id=$1', [
        queueEntryId,
      ])
    ).rows[0];
    if (!visit) throw new ToolError('not_found', 'Visit not found', 404);
    const notes = (
      await db.query('SELECT id,status FROM visit_notes WHERE queue_entry_id=$1', [queueEntryId])
    ).rows;
    const tasks = (
      await db.query(
        "SELECT id,kind,title,status,due_at FROM care_tasks WHERE patient_id=$1 AND status NOT IN ('informed','cancelled') ORDER BY due_at",
        [visit.patient_id],
      )
    ).rows;
    const unsignedDocuments = Number(
      (
        await db.query(
          "SELECT count(*) FROM issued_documents WHERE patient_id=$1 AND status='draft'",
          [visit.patient_id],
        )
      ).rows[0].count,
    );
    const upcoming = (
      await db.query(
        "SELECT starts_at FROM appointments WHERE patient_id=$1 AND starts_at>now() AND status='booked' ORDER BY starts_at LIMIT 1",
        [visit.patient_id],
      )
    ).rows[0];
    const clinical = ctx.actor.kind === 'staff' && ctx.actor.role === 'doctor';
    return {
      visit,
      notes,
      unsignedDocuments,
      instructionDrafts: Number(
        (
          await db.query(
            "SELECT count(*) FROM patient_instructions WHERE patient_id=$1 AND status='draft'",
            [visit.patient_id],
          )
        ).rows[0].count,
      ),
      planDrafts: Number(
        (
          await db.query("SELECT count(*) FROM care_plans WHERE patient_id=$1 AND status='draft'", [
            visit.patient_id,
          ])
        ).rows[0].count,
      ),
      unverifiedEntries: Number(
        (
          await db.query(
            "SELECT count(*) FROM clinical_entries WHERE patient_id=$1 AND status='active' AND verified_at IS NULL",
            [visit.patient_id],
          )
        ).rows[0].count,
      ),
      nextAppointment: upcoming?.starts_at ?? null,
      tasks: clinical
        ? tasks
        : tasks.map(({ id, kind, status, due_at }: any) => ({ id, kind, status, due_at })),
      signedNote: notes.some((n) => n.status === 'signed'),
    };
  },
});
export const careTools = [
  previsitBrief,
  listCareTasks,
  createCareTask,
  updateCareTask,
  visitChecklist,
];
