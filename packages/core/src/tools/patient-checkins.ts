import { z } from 'zod';
import { defineTool, ToolError } from './registry';
const UUID = z.string().uuid();
const allow = ['staff:doctor', 'staff:receptionist'];
export const patientCheckinTools = [
  defineTool({
    name: 'list_patient_checkins',
    description: 'Scheduled patient check-ins and responsible staff.',
    module: 'core',
    allow,
    input: z.object({ patientId: UUID.optional() }),
    auditInput: (i) => ({ patientId: i.patientId }),
    auditOutput: () => ({ opened: true }),
    async run({ db }, i) {
      return {
        checkins: (
          await db.query(
            `SELECT c.*,p.name AS patient_name,u.name AS assignee,
          (c.status='scheduled' AND c.scheduled_at<now()) AS overdue
          FROM patient_checkins c JOIN patients p ON p.id=c.patient_id JOIN staff_users u ON u.id=c.assigned_to
          WHERE ($1::uuid IS NULL OR c.patient_id=$1)
          ORDER BY (c.status='scheduled') DESC,c.scheduled_at LIMIT 200`,
            [i.patientId ?? null],
          )
        ).rows,
        staff: (
          await db.query(
            "SELECT id,name,role FROM staff_users WHERE role IN ('doctor','receptionist') ORDER BY name",
          )
        ).rows,
      };
    },
  }),
  defineTool({
    name: 'schedule_patient_checkin',
    description: 'Record an agreed post-visit check-in; no message is sent.',
    module: 'core',
    allow,
    input: z.object({
      patientId: UUID,
      queueEntryId: UUID,
      assignedTo: UUID,
      scheduledAt: z.string().datetime(),
      language: z.enum(['en', 'hi']),
      consent: z.literal(true),
      reminder: z.boolean().default(false),
    }),
    auditInput: (i) => ({ patientId: i.patientId, queueEntryId: i.queueEntryId }),
    auditOutput: (o) => o,
    async run({ db, ctx }, i) {
      if (Date.parse(i.scheduledAt) <= Date.now())
        throw new ToolError('past_date', 'Choose a future check-in time');
      const patient = (
        await db.query(
          "SELECT id FROM patients WHERE id=$1 AND name<>'Erased patient' AND erasure_requested_at IS NULL FOR UPDATE",
          [i.patientId],
        )
      ).rows[0];
      if (!patient) throw new ToolError('not_found', 'Patient not found', 404);
      const consent = (
        await db.query(
          "SELECT DISTINCT purpose FROM consents WHERE patient_id=$1 AND withdrawn_at IS NULL AND purpose IN ('whatsapp_messaging','reminders_followups')",
          [i.patientId],
        )
      ).rowCount;
      if (consent !== 2)
        throw new ToolError(
          'consent_required',
          'Patient messaging and follow-up permission are required. Record permission through the existing consent process first.',
        );
      if (
        !(
          await db.query(
            "SELECT 1 FROM queue_entries WHERE id=$1 AND patient_id=$2 AND status IN ('called','in_consultation','done')",
            [i.queueEntryId, i.patientId],
          )
        ).rowCount
      )
        throw new ToolError('wrong_visit', 'Choose this patient’s active or completed visit');
      if (
        !(
          await db.query(
            "SELECT 1 FROM staff_users WHERE id=$1 AND role IN ('doctor','receptionist')",
            [i.assignedTo],
          )
        ).rowCount
      )
        throw new ToolError('wrong_owner', 'Choose a staff member from this clinic');
      const result = await db.query(
        `INSERT INTO patient_checkins(clinic_id,patient_id,queue_entry_id,assigned_to,scheduled_at,language,created_by,reminder_enabled)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (clinic_id,queue_entry_id) WHERE status='scheduled' DO NOTHING RETURNING id`,
        [
          ctx.clinicId,
          i.patientId,
          i.queueEntryId,
          i.assignedTo,
          i.scheduledAt,
          i.language,
          ctx.actor.kind === 'staff' ? ctx.actor.userId : null,
          i.reminder,
        ],
      );
      if (!result.rowCount)
        throw new ToolError('duplicate', 'A check-in is already scheduled for this visit');
      return { checkinId: result.rows[0].id };
    },
  }),
  defineTool({
    name: 'cancel_patient_checkin',
    description: 'Cancel a scheduled patient check-in.',
    module: 'core',
    allow,
    input: z.object({ id: UUID }),
    async run({ db }, i) {
      const result = await db.query(
        "UPDATE patient_checkins SET status='cancelled',cancelled_at=now(),cancellation_reason='staff' WHERE id=$1 AND status='scheduled' AND work_status='planned' RETURNING id",
        [i.id],
      );
      if (!result.rowCount) throw new ToolError('not_found', 'Scheduled check-in not found', 404);
      return { ok: true };
    },
  }),
];
