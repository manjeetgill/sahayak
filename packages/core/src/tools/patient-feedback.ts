import { randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
import { detectRedFlagKeywords } from '@sahayak/shared';
import { defineTool, ToolError, type ToolRun } from './registry';
import { hasConsent } from './common';
const uuid = z.string().uuid();
const staff = ['staff:doctor', 'staff:receptionist'];
const doctor = ['staff:doctor'];
export const feedbackResponseInput = z.object({
  recovery: z.enum(['better', 'same', 'worse', 'callback']),
  help: z.enum(['none', 'instructions', 'medicine', 'next_steps', 'visit', 'other']),
  theme: z.enum(['none', 'waiting', 'explanation', 'staff', 'fees', 'booking', 'other']),
  message: z.string().trim().max(2000).default(''),
});
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export async function feedbackEvent(r: ToolRun, id: string, kind: string, note = '') {
  await r.db.query(
    'INSERT INTO patient_feedback_events(clinic_id,checkin_id,actor_id,kind,note) VALUES ($1,$2,$3,$4,$5)',
    [r.ctx.clinicId, id, r.ctx.actor.kind === 'staff' ? r.ctx.actor.userId : null, kind, note],
  );
}
export async function feedbackCase(r: ToolRun, id: string) {
  const c = (await r.db.query('SELECT * FROM patient_checkins WHERE id=$1 FOR UPDATE', [id]))
    .rows[0];
  if (!c) throw new ToolError('not_found', 'Check-in not found', 404);
  return c;
}
export async function validFeedbackLink(r: ToolRun, token: string, allowConsumed = false) {
  const l = (
    await r.db.query(
      `SELECT l.*,c.patient_id,c.status,c.work_status,c.language FROM patient_feedback_links l JOIN patient_checkins c ON c.id=l.checkin_id WHERE token_hash=$1 AND expires_at>now() FOR UPDATE OF l,c`,
      [tokenHash(token)],
    )
  ).rows[0];
  if (!l || l.status === 'cancelled' || (!allowConsumed && l.consumed_at))
    throw new ToolError(
      'expired',
      'This link has expired or has already been used. Please contact the clinic.',
      410,
    );
  return l;
}
export async function issueFeedbackLink(
  r: ToolRun,
  id: string,
  purpose: 'response' | 'resolution',
) {
  const c = await feedbackCase(r, id);
  if (
    c.status === 'cancelled' ||
    !(await hasConsent(r.db, c.patient_id, 'reminders_followups')) ||
    !(await hasConsent(r.db, c.patient_id, 'whatsapp_messaging'))
  )
    throw new ToolError('consent_required', 'Check-in permission has been withdrawn');
  if (purpose === 'resolution' && c.work_status !== 'action_taken')
    throw new ToolError(
      'action_required',
      'Record the clinic action before asking whether it helped',
    );
  if (
    purpose === 'response' &&
    (await r.db.query('SELECT 1 FROM patient_feedback_responses WHERE checkin_id=$1', [id]))
      .rowCount
  )
    throw new ToolError('responded', 'The patient has already responded');
  // Multiple unconsumed links can coexist; the unique response and locked case enforce one response.
  const token = randomBytes(32).toString('hex');
  await r.db.query(
    "INSERT INTO patient_feedback_links(clinic_id,checkin_id,token_hash,purpose,expires_at) VALUES ($1,$2,$3,$4,now()+interval '7 days')",
    [r.ctx.clinicId, id, tokenHash(token), purpose],
  );
  const clinic = (await r.db.query('SELECT slug FROM clinics WHERE id=$1', [r.ctx.clinicId]))
    .rows[0];
  await feedbackEvent(r, id, 'link_prepared');
  return { path: `/c/${clinic.slug}/feedback#${token}`, expiresInDays: 7 };
}
const auditInput = (i: any) => ({ id: i.id });
const auditOutput = () => ({ ok: true });
export const feedbackTools = [
  defineTool({
    name: 'patient_feedback_invitation',
    description: 'Provide an opted-in patient their own pending feedback link.',
    module: 'core',
    allow: ['system'],
    input: z.object({}),
    auditInput: () => ({}),
    auditOutput: () => ({ prepared: true }),
    async run(r) {
      if (!r.ctx.patientId) return { text: 'Please contact the clinic to arrange a check-in.' };
      const c = (
        await r.db.query(
          "SELECT id,work_status FROM patient_checkins WHERE patient_id=$1 AND status='scheduled' AND work_status IN ('planned','action_taken') ORDER BY scheduled_at DESC LIMIT 1",
          [r.ctx.patientId],
        )
      ).rows[0];
      if (!c)
        return {
          text: 'There is no pending check-in form. Please contact the clinic if you need help.',
        };
      let origin: string;
      try {
        const u = new URL(process.env.CHECKIN_PUBLIC_WEB_URL ?? '');
        if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash)
          throw new Error();
        origin = u.origin;
      } catch {
        return {
          text: 'The clinic needs to arrange your check-in directly. Please ask the reception team to contact you.',
        };
      }
      const link = await issueFeedbackLink(
        r,
        c.id,
        c.work_status === 'action_taken' ? 'resolution' : 'response',
      );
      return {
        text:
          r.ctx.lang === 'hi'
            ? `अपने चेक-इन के लिए यह निजी लिंक खोलें: ${origin}${link.path}। उत्तर लगातार नहीं देखे जाते। आपात स्थिति में क्लिनिक के उत्तर का इंतज़ार न करें।`
            : `Here is your private clinic check-in form: ${origin}${link.path}. Replies are not continuously monitored. For an emergency, do not wait for the clinic to reply.`,
      };
    },
  }),
  defineTool({
    name: 'prepare_feedback_link',
    description: 'Create a private expiring patient response link.',
    module: 'core',
    allow: staff,
    input: z.object({ id: uuid, purpose: z.enum(['response', 'resolution']) }),
    auditInput,
    auditOutput,
    run: (r, i) => issueFeedbackLink(r, i.id, i.purpose),
  }),
  defineTool({
    name: 'read_feedback_link',
    description: 'Read minimal check-in form information with a private token.',
    module: 'core',
    allow: ['patient'],
    input: z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }),
    auditInput: () => ({}),
    auditOutput,
    async run(r, i) {
      const l = await validFeedbackLink(r, i.token, true);
      const clinic = (await r.db.query('SELECT name FROM clinics WHERE id=$1', [r.ctx.clinicId]))
        .rows[0];
      return {
        clinic: clinic.name,
        language: l.language,
        purpose: l.purpose,
        submitted: !!l.consumed_at,
      };
    },
  }),
  defineTool({
    name: 'submit_patient_feedback',
    description: 'Save the patient’s own recovery and clinic experience separately.',
    module: 'core',
    allow: ['patient'],
    input: feedbackResponseInput.extend({ token: z.string().regex(/^[a-f0-9]{64}$/) }),
    auditInput: () => ({}),
    auditOutput,
    async run(r, i) {
      const l = await validFeedbackLink(r, i.token, true);
      if (l.purpose !== 'response') throw new ToolError('wrong_link', 'Use the resolution form');
      const prior = (
        await r.db.query('SELECT id FROM patient_feedback_responses WHERE checkin_id=$1', [
          l.checkin_id,
        ])
      ).rows[0];
      if (prior) return { saved: true, duplicate: true };
      const phrases = (await r.db.query('SELECT phrase FROM red_flag_phrases')).rows;
      const urgent = !!detectRedFlagKeywords(i.message, phrases);
      const category =
        ['same', 'worse'].includes(i.recovery) || i.help === 'medicine'
          ? 'clinical'
          : i.recovery === 'callback'
            ? 'callback'
            : ['instructions', 'next_steps'].includes(i.help)
              ? 'instructions'
              : i.theme !== 'none' || i.help === 'visit'
                ? 'service'
                : 'review';
      await r.db.query(
        'INSERT INTO patient_feedback_responses(clinic_id,checkin_id,recovery,help,theme,message) VALUES ($1,$2,$3,$4,$5,$6)',
        [r.ctx.clinicId, l.checkin_id, i.recovery, i.help, i.theme, i.message],
      );
      await r.db.query(
        "UPDATE patient_checkins SET work_status='new',category=$2,urgent=$3,response_due_at=now(),updated_at=now() WHERE id=$1",
        [l.checkin_id, category, urgent],
      );
      await r.db.query(
        "UPDATE patient_feedback_links SET consumed_at=now() WHERE checkin_id=$1 AND purpose='response'",
        [l.checkin_id],
      );
      await feedbackEvent(r, l.checkin_id, 'patient_response');
      r.emit({ type: 'queue_changed' });
      return { saved: true, urgent, checkinId: l.checkin_id };
    },
  }),
  defineTool({
    name: 'resolve_patient_feedback',
    description: 'Record whether the clinic action helped; reopen unresolved concerns.',
    module: 'core',
    allow: ['patient'],
    input: z.object({
      token: z.string().regex(/^[a-f0-9]{64}$/),
      answer: z.enum(['yes', 'partly', 'help']),
    }),
    auditInput: () => ({}),
    auditOutput,
    async run(r, i) {
      const l = await validFeedbackLink(r, i.token, true);
      if (l.purpose !== 'resolution') throw new ToolError('wrong_link', 'Use the check-in form');
      if (l.consumed_at) return { saved: true };
      if (l.work_status !== 'action_taken')
        throw new ToolError('not_ready', 'The clinic is reviewing this concern');
      await r.db.query(
        'INSERT INTO patient_feedback_resolutions(clinic_id,checkin_id,link_id,answer) VALUES ($1,$2,$3,$4)',
        [r.ctx.clinicId, l.checkin_id, l.id, i.answer],
      );
      await r.db.query(
        "UPDATE patient_feedback_links SET consumed_at=now() WHERE checkin_id=$1 AND purpose='resolution'",
        [l.checkin_id],
      );
      await r.db.query(
        "UPDATE patient_checkins SET work_status=$2,response_due_at=CASE WHEN $2='new' THEN now() ELSE response_due_at END,updated_at=now() WHERE id=$1",
        [l.checkin_id, i.answer === 'yes' ? 'closed' : 'new'],
      );
      await feedbackEvent(r, l.checkin_id, 'patient_resolution', i.answer);
      return { saved: true };
    },
  }),
  defineTool({
    name: 'stop_patient_feedback',
    description: 'Stop future check-in contact using the private patient link.',
    module: 'core',
    allow: ['patient'],
    input: z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }),
    auditInput: () => ({}),
    auditOutput,
    async run(r, i) {
      const l = await validFeedbackLink(r, i.token, true);
      await r.db.query(
        "UPDATE consents SET withdrawn_at=now() WHERE patient_id=$1 AND purpose IN ('whatsapp_messaging','reminders_followups') AND withdrawn_at IS NULL",
        [l.patient_id],
      );
      // Keep already reported concerns open for care; cancel only outreach and unused links.
      await r.db.query(
        "UPDATE patient_checkins SET status=CASE WHEN work_status='planned' THEN 'cancelled' ELSE status END,cancelled_at=now(),cancellation_reason='consent_withdrawn' WHERE patient_id=$1",
        [l.patient_id],
      );
      await r.db.query(
        'UPDATE patient_feedback_links SET expires_at=now() WHERE checkin_id IN (SELECT id FROM patient_checkins WHERE patient_id=$1)',
        [l.patient_id],
      );
      await r.db.query(
        "UPDATE follow_ups SET status='skipped',detail='consent_withdrawn' WHERE patient_id=$1 AND status='pending'",
        [l.patient_id],
      );
      await feedbackEvent(r, l.checkin_id, 'opt_out');
      return { ok: true };
    },
  }),
  defineTool({
    name: 'update_feedback_case',
    description: 'Assign, contact, record action and close a feedback concern.',
    module: 'core',
    allow: staff,
    input: z.object({
      id: uuid,
      action: z.enum(['assign', 'contacted', 'action_taken', 'close', 'reopen', 'note']),
      assignedTo: uuid.optional(),
      dueAt: z.string().datetime().optional(),
      note: z.string().trim().min(3).max(2000),
    }),
    auditInput,
    auditOutput,
    async run(r, i) {
      const c = await feedbackCase(r, i.id);
      if (c.status === 'cancelled') throw new ToolError('cancelled', 'This check-in was cancelled');
      if (c.work_status === 'planned')
        throw new ToolError('no_response', 'No patient response is recorded yet');
      const response = (
        await r.db.query(
          'SELECT recovery,help FROM patient_feedback_responses WHERE checkin_id=$1',
          [i.id],
        )
      ).rows[0];
      const clinical =
        c.urgent ||
        ['clinical', 'instructions', 'review'].includes(c.category) ||
        ['same', 'worse'].includes(response?.recovery) ||
        ['medicine', 'instructions', 'next_steps'].includes(response?.help);
      if (
        clinical &&
        ['action_taken', 'close'].includes(i.action) &&
        !(r.ctx.actor.kind === 'staff' && r.ctx.actor.role === 'doctor')
      )
        throw new ToolError('doctor_required', 'A doctor must review this concern', 403);
      if (
        i.assignedTo &&
        !(await r.db.query("SELECT 1 FROM staff_users WHERE id=$1 AND role IN ('doctor','receptionist')", [i.assignedTo])).rowCount
      )
        throw new ToolError('owner', 'Choose a staff member from this clinic');
      if (i.action === 'assign' && !i.assignedTo)
        throw new ToolError('owner', 'Choose a responsible person');
      if (i.action === 'action_taken' && c.work_status !== 'contacted')
        throw new ToolError('order', 'Record patient contact before the clinic action');
      if (i.action === 'close' && c.work_status !== 'action_taken')
        throw new ToolError('order', 'Record the clinic action before closing');
      if (c.work_status === 'closed' && i.action !== 'reopen')
        throw new ToolError('closed', 'Reopen this concern before changing it');
      const status = {
        assign: 'assigned',
        contacted: 'contacted',
        action_taken: 'action_taken',
        close: 'closed',
        reopen: 'new',
        note: c.work_status,
      }[i.action];
      await r.db.query(
        "UPDATE patient_checkins SET work_status=$2,assigned_to=COALESCE($3,assigned_to),response_due_at=COALESCE($4,response_due_at),first_contacted_at=CASE WHEN $5='contacted' THEN COALESCE(first_contacted_at,now()) ELSE first_contacted_at END,updated_at=now() WHERE id=$1",
        [i.id, status, i.assignedTo ?? null, i.dueAt ?? null, i.action],
      );
      await feedbackEvent(r, i.id, i.action, i.note);
      return { ok: true };
    },
  }),
  defineTool({
    name: 'list_feedback_work',
    description: 'Read concerns, original responses and follow-through history.',
    module: 'core',
    allow: staff,
    input: z.object({
      patientId: uuid.optional(),
      filter: z
        .enum([
          'all',
          'clinical',
          'callback',
          'service',
          'instructions',
          'waiting',
          'overdue',
          'closed',
        ])
        .default('all'),
    }),
    auditInput: () => ({}),
    auditOutput,
    async run(r, i) {
      const rows = (
        await r.db.query(
          `SELECT c.*,p.name AS patient_name,p.phone,u.name AS assignee,f.recovery,f.help,f.theme,f.message,f.created_at AS responded_at,
 (SELECT jsonb_agg(e ORDER BY e.created_at) FROM patient_feedback_events e WHERE e.checkin_id=c.id) AS history,
 (SELECT jsonb_agg(d ORDER BY d.created_at) FROM patient_feedback_delivery d WHERE d.checkin_id=c.id) AS delivery,
 (SELECT jsonb_agg(x ORDER BY x.created_at) FROM patient_feedback_resolutions x WHERE x.checkin_id=c.id) AS resolutions
 FROM patient_checkins c JOIN patients p ON p.id=c.patient_id JOIN staff_users u ON u.id=c.assigned_to LEFT JOIN patient_feedback_responses f ON f.checkin_id=c.id
 WHERE ($1::uuid IS NULL OR c.patient_id=$1) AND ($2='all' OR c.category=$2 OR ($2='waiting' AND c.work_status='planned' AND c.status='scheduled') OR ($2='closed' AND c.work_status='closed') OR ($2='overdue' AND c.status='scheduled' AND c.work_status<>'closed' AND COALESCE(c.response_due_at,c.scheduled_at)<now()))
 ORDER BY c.urgent DESC,(c.work_status NOT IN ('closed','planned')) DESC,c.scheduled_at LIMIT 200`,
          [i.patientId ?? null, i.filter],
        )
      ).rows;
      return {
        cases: rows,
        staff: (await r.db.query("SELECT id,name,role FROM staff_users WHERE role IN ('doctor','receptionist') ORDER BY name")).rows,
      };
    },
  }),
  defineTool({
    name: 'feedback_report',
    description:
      'Response rates, service themes and improvement tasks; no inferred retention scores.',
    module: 'core',
    allow: doctor,
    input: z.object({}),
    auditOutput,
    async run({ db }) {
      return {
        counts: (
          await db.query(`SELECT count(*)::int AS scheduled,count(*) FILTER(WHERE EXISTS(SELECT 1 FROM patient_feedback_delivery d WHERE d.checkin_id=c.id AND d.delivered_at IS NOT NULL) OR c.first_contacted_at IS NOT NULL)::int AS contacted,
 count(f.id)::int AS responded,count(f.id) FILTER(WHERE c.work_status<>'closed')::int AS unresolved,
 count(*) FILTER(WHERE c.work_status='closed')::int AS closed,
 round(avg(extract(epoch FROM (c.first_contacted_at-f.created_at))/3600) FILTER(WHERE c.first_contacted_at>=f.created_at)::numeric,1) AS hours_to_contact
 FROM patient_checkins c LEFT JOIN patient_feedback_responses f ON f.checkin_id=c.id WHERE c.created_at>now()-interval '30 days'`)
        ).rows[0],
        themes: (
          await db.query(
            "SELECT f.theme,count(*)::int AS count,jsonb_agg(jsonb_build_object('id',c.id,'patient',p.name)) AS sources FROM patient_feedback_responses f JOIN patient_checkins c ON c.id=f.checkin_id JOIN patients p ON p.id=c.patient_id WHERE f.theme<>'none' AND f.created_at>now()-interval '30 days' GROUP BY f.theme ORDER BY count(*) DESC",
          )
        ).rows,
        resolutions: (
          await db.query(
            "SELECT answer,count(*)::int AS count FROM patient_feedback_resolutions WHERE created_at>now()-interval '30 days' GROUP BY answer",
          )
        ).rows,
        improvements: (
          await db.query(
            'SELECT i.*,u.name AS assignee FROM patient_feedback_improvements i JOIN staff_users u ON u.id=i.assigned_to ORDER BY i.status,i.due_at',
          )
        ).rows,
      };
    },
  }),
  defineTool({
    name: 'save_feedback_improvement',
    description: 'Assign a clinic improvement from patient feedback.',
    module: 'core',
    allow: doctor,
    input: z.object({
      id: uuid.optional(),
      sourceId: uuid.optional(),
      title: z.string().trim().min(3).max(200),
      assignedTo: uuid,
      dueAt: z.string().datetime(),
      done: z.boolean().default(false),
    }),
    auditInput,
    auditOutput,
    async run(r, i) {
      if (!(await r.db.query("SELECT 1 FROM staff_users WHERE id=$1 AND role IN ('doctor','receptionist')", [i.assignedTo])).rowCount)
        throw new ToolError('owner', 'Choose a clinic staff member');
      if (i.sourceId) await feedbackCase(r, i.sourceId);
      if (i.id) {
        const result = await r.db.query(
          'UPDATE patient_feedback_improvements SET title=$2,assigned_to=$3,due_at=$4,status=$5 WHERE id=$1 RETURNING id',
          [i.id, i.title, i.assignedTo, i.dueAt, i.done ? 'done' : 'open'],
        );
        if (!result.rowCount) throw new ToolError('not_found', 'Improvement not found', 404);
      } else
        await r.db.query(
          'INSERT INTO patient_feedback_improvements(clinic_id,source_checkin_id,title,assigned_to,due_at) VALUES($1,$2,$3,$4,$5)',
          [r.ctx.clinicId, i.sourceId ?? null, i.title, i.assignedTo, i.dueAt],
        );
      return { ok: true };
    },
  }),
];
