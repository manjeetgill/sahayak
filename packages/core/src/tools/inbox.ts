import { z } from 'zod';
import { defineTool, ToolError } from './registry';

export const doctorInbox = defineTool({
  name: 'get_doctor_inbox',
  module: 'core',
  description: 'Prioritised source-linked clinic work and the current doctor’s unsigned drafts.',
  input: z.object({
    page: z.coerce.number().int().min(0).default(0),
    view: z.enum(['all', 'mine', 'later']).default('all'),
    all: z.boolean().optional(),
    category: z
      .enum([
        'all',
        'urgent',
        'task',
        'followup',
        'report',
        'draft',
        'messages',
        'result',
        'payment',
        'insurance',
        'checkin',
      ])
      .default('all'),
  }),
  allow: ['staff:doctor'],
  auditOutput: (o: any) => ({ count: o.total }),
  async run({ db, ctx }, input) {
    const doctor = ctx.actor.kind === 'staff' ? ctx.actor.doctorId : null;
    const result = await db.query(
      `WITH items AS (
      SELECT 'alert:' || COALESCE(f.conversation_id,f.id)::text AS key, 'alert' AS kind,
        (array_agg(f.patient_id ORDER BY f.created_at DESC))[1] AS patient_id,
        CASE WHEN bool_or(f.severity='urgent') THEN 0 ELSE 2 END AS priority,
        CASE WHEN bool_or(f.severity='urgent') THEN 'Urgent patient alert' ELSE 'Patient needs help' END AS title,
        count(*)::text || ' open alert(s). Review the conversation and recorded concerns.' AS reason,
        min(f.created_at) AS happened_at, NULL::timestamptz AS due_at,
        NULL::text AS assignee, f.conversation_id, NULL::text AS path,
        jsonb_agg(jsonb_build_object('id',f.id,'summary',f.summary,'kind',f.kind,'created_at',f.created_at) ORDER BY f.created_at DESC) AS alerts
      FROM flags f WHERE f.status='open' GROUP BY COALESCE(f.conversation_id,f.id),f.conversation_id
      UNION ALL
      SELECT 'conversation:'||c.id,'conversation',c.patient_id,2,'Patient message needs a reply',
        'This conversation is being handled by staff.',(SELECT max(created_at) FROM messages WHERE conversation_id=c.id AND direction='in'),NULL,u.name,c.id,NULL,'[]'::jsonb
      FROM conversations c LEFT JOIN staff_users u ON u.id=c.human_user_id
      WHERE c.handled_by='human'
        AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id=c.id AND m.direction='in'
          AND NOT EXISTS (SELECT 1 FROM messages reply WHERE reply.conversation_id=c.id AND reply.direction='out' AND reply.sender LIKE 'staff:%' AND reply.created_at>=m.created_at))
        AND NOT EXISTS (SELECT 1 FROM flags f WHERE f.conversation_id=c.id AND f.status='open')
      UNION ALL
      SELECT 'task:'||t.id,'task',t.patient_id,CASE WHEN t.due_at<now() THEN 1 WHEN t.status IN ('received','reviewed') THEN 2 ELSE 3 END,
        t.title,CASE t.status WHEN 'requested' THEN 'Requested work is still outstanding.' WHEN 'received' THEN 'Ready for doctor review.' ELSE 'Patient still needs to be informed.' END,
        t.created_at,t.due_at,u.name,NULL,'/doctor/patients/'||t.patient_id||'#care-tasks','[]'::jsonb
      FROM care_tasks t LEFT JOIN staff_users u ON u.id=t.assigned_to WHERE t.status NOT IN ('informed','cancelled')
      UNION ALL
      SELECT 'checkin:'||c.id,'checkin',c.patient_id,CASE WHEN c.urgent THEN 0 WHEN COALESCE(c.response_due_at,c.scheduled_at)<now() THEN 1 ELSE 2 END,
        CASE WHEN c.urgent THEN 'Urgent patient check-in' WHEN c.work_status='planned' THEN 'Patient check-in due' ELSE 'Patient feedback needs follow-through' END,
        CASE WHEN c.work_status='planned' THEN 'No response recorded; review contact and delivery status.' ELSE 'Review the original response and record the clinic action.' END,
        c.updated_at,COALESCE(c.response_due_at,c.scheduled_at),u.name,NULL,'/doctor/checkins#case-'||c.id,'[]'::jsonb
      FROM patient_checkins c JOIN staff_users u ON u.id=c.assigned_to WHERE c.status='scheduled' AND c.work_status<>'closed' AND (c.work_status<>'planned' OR c.scheduled_at<now())
      UNION ALL
      SELECT 'report:'||d.id,'report',d.patient_id,2,'Report or photo awaiting review',d.filename,d.created_at,NULL,NULL,NULL,
        '/doctor/patients/'||d.patient_id||'#documents','[]'::jsonb FROM patient_documents d WHERE d.status='new'
        AND NOT EXISTS (SELECT 1 FROM care_tasks t WHERE t.document_id=d.id AND t.status NOT IN ('informed','cancelled'))
      UNION ALL
      SELECT 'note:'||n.id,'draft',n.patient_id,2,'Visit note needs your signature','Review and sign your draft note.',n.created_at,NULL,'You',NULL,
        '/doctor/patients/'||n.patient_id||'#note-composer','[]'::jsonb
      FROM visit_notes n
      WHERE n.status='draft' AND (n.doctor_id=$1 OR $7::boolean)
      UNION ALL
      SELECT 'certificate:'||d.id,'draft',d.patient_id,2,'Document needs your signature','Review your draft certificate or prescription.',d.created_at,NULL,NULL,NULL,
        '/doctor/patients/'||d.patient_id||'#issued-documents','[]'::jsonb FROM issued_documents d WHERE d.status='draft' AND (d.doctor_id=$1 OR $7::boolean)
      UNION ALL
      SELECT 'step:'||s.id,'followup',s.patient_id,CASE WHEN s.status IN ('needs_review','no_response') OR (s.status='contacted' AND s.response_due_at<now()) THEN 1 WHEN s.due_at<now() THEN 1 ELSE 3 END,
        s.title,CASE WHEN s.status='no_response' OR (s.status='contacted' AND s.response_due_at<now()) THEN 'No reply recorded by the deadline. Follow up or arrange staff review.' WHEN s.status='needs_review' THEN 'Patient reply needs doctor review.' WHEN s.status='contacted' THEN 'Contact recorded; waiting for a response or review.' ELSE 'Approved follow-up step. Contact the patient through your usual clinic process.' END,
        s.created_at,s.due_at,u.name,NULL,'/doctor/patients/'||s.patient_id||'#care-workspace','[]'::jsonb
      FROM care_plan_steps s JOIN care_plans p ON p.id=s.plan_id JOIN staff_users u ON u.id=p.assigned_to
      WHERE p.status='active' AND s.status NOT IN ('completed','cancelled')
      UNION ALL
      SELECT 'instruction:'||i.id,'draft',i.patient_id,2,'Patient instructions need approval','Review instructions against the signed visit note.',i.created_at,NULL,NULL,NULL,
        '/doctor/patients/'||i.patient_id||'#care-workspace','[]'::jsonb FROM patient_instructions i WHERE i.status='draft' AND i.created_by=$2
      UNION ALL
      SELECT 'clinical:'||e.id,'report',e.patient_id,2,'Recorded information needs verification','Check this entry against the original source.',e.created_at,NULL,NULL,NULL,
        '/doctor/patients/'||e.patient_id||'#care-workspace','[]'::jsonb FROM clinical_entries e WHERE e.verified_at IS NULL AND e.status='active'
      UNION ALL
      SELECT 'insurance:'||c.id,'insurance',c.patient_id,CASE WHEN c.due_at<now() THEN 1 ELSE 3 END,c.title,'Insurance paperwork: '||replace(c.status,'_',' '),c.created_at,c.due_at,u.name,NULL,'/doctor/patients/'||c.patient_id||'#insurance-work','[]'::jsonb
      FROM insurance_cases c JOIN staff_users u ON u.id=c.assigned_to WHERE c.status NOT IN ('closed','cancelled')
      UNION ALL
      SELECT 'result:'||e.id,'result',e.patient_id,2,'Test result outside supplied report range','Doctor review is not yet recorded; check the original report.',e.created_at,NULL,NULL,NULL,'/doctor/patients/'||e.patient_id||'#care-workspace','[]'::jsonb
      FROM clinical_entries e WHERE e.kind='lab' AND e.status='active' AND e.verified_at IS NOT NULL AND e.result_reviewed_at IS NULL
      AND ((e.data->>'value')::numeric < (e.data->>'low')::numeric OR (e.data->>'value')::numeric > (e.data->>'high')::numeric)
      UNION ALL
      SELECT 'payment:'||o.id,'payment',a.patient_id,1,'Payment needs checking',
        CASE WHEN o.state='review' THEN 'The provider reported a payment that needs staff review. Do not collect it again.'
             ELSE 'Payment status is uncertain. Check the provider before asking the patient to retry.' END,
        o.updated_at,NULL,NULL,NULL,'/console/arrivals','[]'::jsonb
      FROM qr_payment_orders o JOIN qr_arrivals a ON a.id=o.arrival_id
      WHERE o.state IN ('review','unknown')
    ), enriched AS (SELECT i.*,p.name AS patient_name,
      CASE
        WHEN i.kind='alert' THEN COALESCE(
          (SELECT human_user_id FROM conversations WHERE id=i.conversation_id),
          (SELECT id FROM staff_users WHERE solo_owner LIMIT 1))
        WHEN i.kind='conversation' THEN (SELECT human_user_id FROM conversations WHERE id=i.conversation_id)
        WHEN i.kind='task' THEN (SELECT assigned_to FROM care_tasks WHERE id=split_part(i.key,':',2)::uuid)
        WHEN i.kind='followup' THEN (SELECT cp.assigned_to FROM care_plan_steps cs JOIN care_plans cp ON cp.id=cs.plan_id WHERE cs.id=split_part(i.key,':',2)::uuid)
        WHEN i.kind='checkin' THEN (SELECT assigned_to FROM patient_checkins WHERE id=split_part(i.key,':',2)::uuid)
        WHEN i.kind='insurance' THEN (SELECT assigned_to FROM insurance_cases WHERE id=split_part(i.key,':',2)::uuid)
        WHEN i.kind='draft' THEN $2::uuid
        ELSE NULL::uuid
      END AS source_assigned_to,
      CASE WHEN r.item_key IS NULL THEN NULL ELSE to_jsonb(r)||jsonb_build_object('assigned_name',u.name,
        'acknowledged_at', CASE WHEN r.acknowledged_at < CASE WHEN i.kind='alert' THEN (SELECT max((a->>'created_at')::timestamptz) FROM jsonb_array_elements(i.alerts) a) ELSE i.happened_at END THEN NULL ELSE r.acknowledged_at END) END AS review,
      COALESCE(i.priority<>0 AND r.snoozed_until>now(),false) AS is_later
      FROM items i LEFT JOIN patients p ON p.id=i.patient_id LEFT JOIN inbox_reviews r ON r.item_key=i.key LEFT JOIN staff_users u ON u.id=r.assigned_to
      WHERE NOT (i.kind='conversation' AND r.handled_at IS NOT NULL AND r.handled_at>=i.happened_at)
    ), scoped AS (SELECT * FROM enriched WHERE (CASE WHEN $3='later' THEN is_later ELSE NOT is_later END)
      AND ($3<>'mine' OR COALESCE((review->>'assigned_to')::uuid,source_assigned_to)=$2::uuid)
      AND ($6='all' OR ($6='urgent' AND priority=0) OR ($6='messages' AND kind IN ('alert','conversation')) OR kind=$6))
    SELECT COALESCE((SELECT jsonb_agg(x) FROM (SELECT * FROM scoped ORDER BY priority,COALESCE(due_at,happened_at),key LIMIT CASE WHEN $5 THEN NULL ELSE 50 END OFFSET CASE WHEN $5 THEN 0 ELSE $4*50 END)x),'[]'::jsonb) AS items,
      (SELECT count(*)::int FROM scoped) AS total,
      (SELECT count(*)::int FROM enriched WHERE priority=0) AS urgent,
      (SELECT count(*)::int FROM enriched WHERE priority=1 AND NOT is_later) AS overdue,
      (SELECT count(*)::int FROM enriched WHERE is_later) AS later`,
      [
        doctor,
        ctx.actor.kind === 'staff' ? ctx.actor.userId : null,
        input.view,
        input.page,
        input.all ?? false,
        input.category ?? 'all',
        ctx.actor.kind === 'staff' && ctx.actor.role === 'admin',
      ],
    );
    const doctors = (
      await db.query("SELECT id,name FROM staff_users WHERE role='doctor' ORDER BY name")
    ).rows;
    return {
      ...result.rows[0],
      page: input.page,
      staff: doctors,
      generatedAt: new Date().toISOString(),
    };
  },
});
export const inboxConversation = defineTool({
  name: 'get_inbox_conversation',
  module: 'core',
  description: 'Doctor reviews a source conversation.',
  input: z.object({ conversationId: z.string().uuid() }),
  allow: ['staff:doctor'],
  auditOutput: () => ({ reviewed: true }),
  async run({ db }, { conversationId }) {
    if (!(await db.query('SELECT id FROM conversations WHERE id=$1', [conversationId])).rowCount)
      throw new ToolError('not_found', 'Conversation not found', 404);
    return {
      messages: (
        await db.query(
          `SELECT direction,body,created_at FROM (
      SELECT id,direction,body,created_at FROM messages WHERE conversation_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100
      ) m ORDER BY created_at,id`,
          [conversationId],
        )
      ).rows,
    };
  },
});
export const updateInboxReview = defineTool({
  name: 'update_inbox_review',
  module: 'core',
  description: 'Assign, acknowledge, defer or resolve source-linked inbox work.',
  allow: ['staff:doctor'],
  input: z.object({
    key: z.string().max(100),
    action: z.enum(['assign', 'acknowledge', 'later', 'restore', 'handled']),
    assignedTo: z.string().uuid().optional(),
    until: z.string().datetime().optional(),
    reason: z.string().trim().min(3).max(500).optional(),
  }),
  auditInput: (i) => ({ key: i.key, action: i.action }),
  auditOutput: () => ({ saved: true }),
  async run(r, i) {
    const source: any = await doctorInbox.run(r, {
      page: 0,
      view: 'all',
      all: true,
      category: 'all',
    });
    const later: any = await doctorInbox.run(r, {
      page: 0,
      view: 'later',
      all: true,
      category: 'all',
    });
    const item = [...source.items, ...later.items].find((x: any) => x.key === i.key);
    if (!item)
      throw new ToolError(
        'not_found',
        'This item is no longer outstanding. Refresh the list.',
        404,
      );
    const actor = r.ctx.actor.kind === 'staff' ? r.ctx.actor.userId : null;
    if (
      i.action === 'assign' &&
      (!i.assignedTo ||
        !(
          await r.db.query("SELECT id FROM staff_users WHERE id=$1 AND role='doctor'", [
            i.assignedTo,
          ])
        ).rowCount)
    )
      throw new ToolError('assignee', 'Choose a doctor in this clinic');
    if (
      i.action === 'later' &&
      (item.priority === 0 ||
        !i.until ||
        Date.parse(i.until) <= Date.now() ||
        Date.parse(i.until) > Date.now() + 30 * 86400000)
    )
      throw new ToolError(
        'snooze',
        'Urgent alerts cannot be hidden. Other work can be deferred for up to 30 days.',
      );
    if (i.action === 'handled' && !['alert', 'conversation'].includes(item.kind))
      throw new ToolError('source_required', 'Complete this work in its original record.');
    if (i.action === 'handled' && !i.reason)
      throw new ToolError('reason', 'Record why the item is handled');
    await r.db.query(
      'INSERT INTO inbox_reviews(clinic_id,item_key,patient_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [r.ctx.clinicId, i.key, item.patient_id],
    );
    if (i.action === 'assign')
      await r.db.query(
        'UPDATE inbox_reviews SET assigned_to=$2,updated_at=now() WHERE item_key=$1',
        [i.key, i.assignedTo],
      );
    if (i.action === 'acknowledge')
      await r.db.query(
        'UPDATE inbox_reviews SET acknowledged_at=now(),acknowledged_by=$2,updated_at=now() WHERE item_key=$1',
        [i.key, actor],
      );
    if (['later', 'restore'].includes(i.action))
      await r.db.query(
        'UPDATE inbox_reviews SET snoozed_until=$2,updated_at=now() WHERE item_key=$1',
        [i.key, i.action === 'later' ? i.until : null],
      );
    if (i.action === 'handled') {
      // Resolve only the flags reviewed in this snapshot; new alerts remain open.
      for (const alert of item.alerts) {
        await r.db.query(
          "UPDATE flags SET status='resolved',resolved_at=now(),resolved_by=$2 WHERE id=$1 AND status='open'",
          [alert.id, actor],
        );
        r.emit({ type: 'flag_resolved', flagId: alert.id });
      }
      await r.db.query(
        'UPDATE inbox_reviews SET handled_at=$4,handled_reason=$3,acknowledged_at=now(),acknowledged_by=$2,updated_at=now() WHERE item_key=$1',
        [i.key, actor, i.reason, item.happened_at],
      );
    }
    return { saved: true };
  },
});
export const inboxTools = [doctorInbox, inboxConversation, updateInboxReview];
