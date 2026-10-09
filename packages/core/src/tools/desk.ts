import { z } from 'zod';
import { defineTool, ToolError } from './registry';
import { emitWebhook } from '../webhooks';
import {
  assertOwn,
  clinicToday,
  ensureConversation,
  getSettings,
  hasConsent,
  storeMessage,
  deliver,
} from './common';

const STAFF = ['staff:doctor', 'staff:receptionist'];
const AGENTS = [
  'agent:checkin',
  'agent:queue',
  'agent:intake',
  'agent:front_desk',
  'agent:schedule',
  'agent:followup',
  'agent:leads',
  'agent:records',
];

export const getClinicInfo = defineTool({
  name: 'get_clinic_info',
  description:
    'Clinic timings, address, directions, phone and doctors. This is the ONLY source for answering clinic questions.',
  scope: 'read',
  module: 'core',
  input: z.object({}),
  allow: [...AGENTS, ...STAFF, 'patient', 'system', 'api'],
  async run({ db, ctx }) {
    const s = await getSettings(db, ctx.clinicId);
    const docs = await db.query(
      'SELECT id, name, speciality FROM doctors WHERE active ORDER BY name',
    );
    return {
      clinic: s.clinic_name,
      timezone: s.timezone,
      faqs: (s as any).faqs ?? [],
      reviewUrl: (s as any).reputation?.review_url || null,
      agents: (s as any).agents ?? {},
      address: s.address,
      directions: s.directions,
      phone: s.phone,
      timings: s.timings,
      doctors: docs.rows,
    };
  },
});

export const flagToReceptionist = defineTool({
  name: 'flag_to_receptionist',
  description: 'Raise an item on the receptionist console.',
  module: 'core',
  input: z.object({
    kind: z.enum(['medical_question', 'human_requested', 'upset', 'system', 'other']),
    summary: z.string().min(1).max(500),
    severity: z.enum(['normal', 'urgent']).default('normal'),
  }),
  allow: [...AGENTS, 'system'],
  async run({ db, ctx, emit }, i) {
    const f = await db.query(
      'INSERT INTO flags (clinic_id,conversation_id,patient_id,kind,severity,summary) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [
        ctx.clinicId,
        ctx.conversationId ?? null,
        ctx.patientId ?? null,
        i.kind,
        i.severity,
        i.summary,
      ],
    );
    emit({ type: 'flag_raised', flagId: f.rows[0].id, severity: i.severity });
    await emitWebhook(
      db,
      ctx.clinicId,
      'flag.raised',
      {
        flagId: f.rows[0].id,
        kind: i.kind,
        severity: i.severity,
        patientId: ctx.patientId ?? null,
      },
      { patientId: ctx.patientId, extra: { summary: i.summary } },
    );
    return { flagId: f.rows[0].id as string };
  },
});

export const raiseRedFlag = defineTool({
  name: 'raise_red_flag',
  description:
    'Possible emergency reported by a patient: loud console alert plus doctor notification.',
  module: 'core',
  input: z.object({
    topic: z.string(),
    source: z.enum(['keywords', 'classifier']),
    excerpt: z.string().max(300),
  }),
  allow: ['system'],
  async run({ db, ctx, emit }, i) {
    const f = await db.query(
      "INSERT INTO flags (clinic_id,conversation_id,patient_id,kind,severity,summary) VALUES ($1,$2,$3,'red_flag','urgent',$4) RETURNING id",
      [
        ctx.clinicId,
        ctx.conversationId ?? null,
        ctx.patientId ?? null,
        `Possible emergency (${i.topic}, detected by ${i.source}): "${i.excerpt}"`,
      ],
    );
    emit({ type: 'flag_raised', flagId: f.rows[0].id, severity: 'urgent' });
    await emitWebhook(
      db,
      ctx.clinicId,
      'flag.raised',
      {
        flagId: f.rows[0].id,
        kind: 'red_flag',
        severity: 'urgent',
        topic: i.topic,
        patientId: ctx.patientId ?? null,
      },
      { patientId: ctx.patientId, extra: { excerpt: i.excerpt } },
    );
    return { flagId: f.rows[0].id as string, doctorNotified: true };
  },
});

export const resolveFlag = defineTool({
  name: 'resolve_flag',
  description: 'Mark a console flag as handled.',
  module: 'core',
  input: z.object({ flagId: z.string().uuid() }),
  allow: STAFF,
  async run({ db, ctx, emit }, { flagId }) {
    const a = ctx.actor;
    const u = await db.query(
      "UPDATE flags SET status='resolved', resolved_at=now(), resolved_by=$2 WHERE id=$1 AND status='open' RETURNING id",
      [flagId, a.kind === 'staff' ? a.userId : null],
    );
    if (!u.rowCount) throw new ToolError('not_found', 'Flag not found or already resolved', 404);
    emit({ type: 'flag_resolved', flagId });
    return { ok: true };
  },
});

export const handoffToHuman = defineTool({
  name: 'handoff_to_human',
  description:
    'Hand this conversation to the receptionist (patient asked for a person, or is upset).',
  module: 'core',
  input: z.object({
    reason: z.enum(['human_requested', 'upset', 'other']),
    summary: z.string().max(500),
  }),
  allow: [...AGENTS, 'system'],
  async run({ db, ctx, emit }, i) {
    if (!ctx.conversationId) throw new ToolError('no_conversation', 'No active conversation');
    const owner = (await db.query(
      `SELECT u.id FROM clinic_settings s JOIN staff_users u ON u.clinic_id=s.clinic_id
       WHERE s.clinic_id=$1 AND s.workspace_mode='solo' AND u.solo_owner LIMIT 1`,
      [ctx.clinicId],
    )).rows[0]?.id ?? null;
    await db.query(
      "UPDATE conversations SET handled_by='human',human_user_id=COALESCE($2,human_user_id) WHERE id=$1",
      [ctx.conversationId, owner],
    );
    const f = await db.query(
      "INSERT INTO flags (clinic_id,conversation_id,patient_id,kind,severity,summary) VALUES ($1,$2,$3,$4,'normal',$5) RETURNING id",
      [
        ctx.clinicId,
        ctx.conversationId,
        ctx.patientId ?? null,
        i.reason === 'other' ? 'other' : i.reason,
        i.summary,
      ],
    );
    emit({ type: 'flag_raised', flagId: f.rows[0].id, severity: 'normal' });
    emit({ type: 'conversation_updated', conversationId: ctx.conversationId });
    await emitWebhook(
      db,
      ctx.clinicId,
      'flag.raised',
      {
        flagId: f.rows[0].id,
        kind: i.reason,
        severity: 'normal',
        patientId: ctx.patientId ?? null,
      },
      { patientId: ctx.patientId, extra: { summary: i.summary } },
    );
    return { flagId: f.rows[0].id as string, assignedTo: owner };
  },
});

export const takeOverConversation = defineTool({
  name: 'take_over_conversation',
  description: 'Receptionist takes over (human) or returns (agent) a conversation.',
  module: 'core',
  input: z.object({ conversationId: z.string().uuid(), to: z.enum(['human', 'agent']) }),
  allow: ['staff:receptionist'],
  async run({ db, ctx, emit }, i) {
    const a = ctx.actor;
    if (
      i.to === 'agent' &&
      (
        await db.query(
          "SELECT 1 FROM flags WHERE conversation_id=$1 AND status='open' AND severity='urgent' LIMIT 1",
          [i.conversationId],
        )
      ).rowCount
    )
      throw new ToolError(
        'urgent_flag_open',
        'Resolve the urgent flag before returning this conversation to the agent.',
        409,
      );
    const u = await db.query(
      'UPDATE conversations SET handled_by=$2, human_user_id=$3 WHERE id=$1 RETURNING id',
      [i.conversationId, i.to, i.to === 'human' && a.kind === 'staff' ? a.userId : null],
    );
    if (!u.rowCount) throw new ToolError('not_found', 'Conversation not found', 404);
    emit({ type: 'conversation_updated', conversationId: i.conversationId });
    return { ok: true };
  },
});

export const sendMessage = defineTool({
  name: 'send_message',
  description:
    "Send a message in a conversation. proactive=true (not a reply) requires the patient's messaging consent.",
  module: 'core',
  input: z.object({
    conversationId: z.string().uuid(),
    text: z.string().min(1).max(2000),
    proactive: z.boolean().default(false),
  }),
  allow: [...AGENTS, ...STAFF, 'system'],
  async run(r, i) {
    const { db, ctx, rt } = r;
    const c = await db.query(
      'SELECT id, contact, patient_id, language, channel FROM conversations WHERE id=$1',
      [i.conversationId],
    );
    if (!c.rowCount) throw new ToolError('not_found', 'Conversation not found', 404);
    const conv = c.rows[0];
    if (
      i.proactive &&
      !(conv.patient_id && (await hasConsent(db, conv.patient_id, 'whatsapp_messaging')))
    ) {
      throw new ToolError('no_consent', 'Patient has not consented to messages');
    }
    const sender =
      ctx.actor.kind === 'staff'
        ? `staff:${ctx.actor.userId}`
        : ctx.actor.kind === 'agent'
          ? `agent:${ctx.actor.agent}`
          : 'system';
    await storeMessage(db, ctx.clinicId, conv.id, 'out', sender, i.text);
    await deliver(r, {
      to: conv.contact,
      text: i.text,
      lang: conv.language,
      channel: conv.channel,
    });
    r.emit({ type: 'conversation_updated', conversationId: conv.id });
    return { ok: true };
  },
});

export const getIntakeQuestions = defineTool({
  name: 'get_intake_questions',
  description: "The clinic's standard intake questions.",
  module: 'core',
  input: z.object({}),
  allow: ['agent:intake', ...STAFF],
  async run({ db, ctx }) {
    return { questions: (await getSettings(db, ctx.clinicId)).intake_questions };
  },
});

export const saveIntake = defineTool({
  name: 'save_intake_answers',
  description:
    "Save the patient's intake answers and a factual summary for the doctor. No diagnosis, no advice.",
  module: 'core',
  input: z.object({
    patientId: z.string().uuid(),
    answers: z.array(z.object({ question: z.string(), answer: z.string().max(1000) })).min(1),
    summary: z.string().max(1500).optional(),
  }),
  allow: ['agent:intake', ...STAFF],
  async run({ db, ctx, emit }, i) {
    assertOwn(ctx, i.patientId);
    const { date } = await clinicToday(db, ctx.clinicId);
    const q = await db.query(
      "SELECT id FROM queue_entries WHERE patient_id=$1 AND queue_date=$2 AND status IN ('waiting','called','in_consultation','on_hold') ORDER BY token_number DESC LIMIT 1",
      [i.patientId, date],
    );
    const summary = i.summary ?? i.answers.map((a) => `${a.question}: ${a.answer}`).join(' | ');
    await db.query(
      'INSERT INTO intake_summaries (clinic_id,patient_id,queue_entry_id,answers,summary) VALUES ($1,$2,$3,$4,$5)',
      [ctx.clinicId, i.patientId, q.rows[0]?.id ?? null, JSON.stringify(i.answers), summary],
    );
    emit({ type: 'queue_changed' });
    return { ok: true };
  },
});

export const getPatientHistory = defineTool({
  name: 'get_patient_history',
  description:
    "A patient's own past Sahayak visits and intake summaries (never another patient's).",
  module: 'core',
  input: z.object({ patientId: z.string().uuid() }),
  allow: ['agent:records', ...STAFF],
  async run({ db, ctx }, { patientId }) {
    assertOwn(ctx, patientId);
    const v = await db.query(
      `SELECT queue_date, status FROM queue_entries WHERE patient_id=$1 ORDER BY queue_date DESC LIMIT 10`,
      [patientId],
    );
    const s = await db.query(
      'SELECT created_at, summary FROM intake_summaries WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 5',
      [patientId],
    );
    return { visits: v.rows, intakeSummaries: s.rows };
  },
});

export const receiveMessage = defineTool({
  name: 'receive_message',
  description:
    'Store an inbound patient message, creating/linking the conversation and patient (by phone).',
  module: 'core',
  input: z.object({
    from: z.string(),
    text: z.string().min(1).max(2000),
    language: z.enum(['en', 'hi']).optional(),
    channel: z.enum(['whatsapp', 'voice', 'web']).default('whatsapp'),
    doctorId: z.string().uuid().optional(),
  }),
  allow: ['patient', 'system'],
  async run({ db, ctx, emit }, i) {
    const p = await db.query('SELECT id, language FROM patients WHERE phone=$1', [i.from]);
    const patientId: string | null = p.rows[0]?.id ?? null;
    const s = await getSettings(db, ctx.clinicId);
    const lang = i.language ?? p.rows[0]?.language ?? s.default_language;
    const conv = await ensureConversation(db, ctx.clinicId, i.from, patientId, lang, i.channel);
    if (i.language)
      await db.query('UPDATE conversations SET language=$2 WHERE id=$1', [conv.id, i.language]);
    if (i.doctorId)
      await db.query('UPDATE conversations SET doctor_id=$2 WHERE id=$1', [conv.id, i.doctorId]);
    await storeMessage(db, ctx.clinicId, conv.id, 'in', 'patient', i.text);
    const c = (
      await db.query(
        'SELECT id, handled_by, state, language, doctor_id FROM conversations WHERE id=$1',
        [conv.id],
      )
    ).rows[0];
    emit({ type: 'conversation_updated', conversationId: conv.id });
    await emitWebhook(
      db,
      ctx.clinicId,
      'message.received',
      { conversationId: c.id, patientId, channel: i.channel },
      { patientId, extra: { text: i.text } },
    );
    return {
      conversationId: c.id as string,
      patientId,
      language: c.language as 'en' | 'hi',
      doctorId: (c.doctor_id ?? null) as string | null,
      handledBy: c.handled_by as 'agent' | 'human',
      state: (c.state ?? {}) as Record<string, any>,
    };
  },
});

export const receiveCallMessage = defineTool({
  name: 'receive_call_message',
  description: 'Receive one authenticated platform call turn in an isolated call conversation.',
  module: 'core',
  input: z.object({
    callId: z.string().uuid(),
    agentId: z.string().uuid(),
    text: z.string().min(1).max(2000),
    language: z.enum(['en', 'hi']),
  }),
  allow: ['system'],
  auditInput: (i) => ({ callId: i.callId }),
  auditOutput: (o: { conversationId: string }) => ({ conversationId: o.conversationId }),
  async run({ db, ctx, emit }, i) {
    const conv = await ensureConversation(
      db,
      ctx.clinicId,
      'voice:' + i.agentId + ':' + i.callId,
      null,
      i.language,
      'voice',
    );
    await storeMessage(db, ctx.clinicId, conv.id, 'in', 'patient', i.text);
    const c = (
      await db.query('SELECT patient_id,state,handled_by,language FROM conversations WHERE id=$1', [
        conv.id,
      ])
    ).rows[0];
    emit({ type: 'conversation_updated', conversationId: conv.id });
    return {
      conversationId: conv.id,
      patientId: c.patient_id as string | null,
      state: c.state,
      handledBy: c.handled_by,
      language: c.language,
    };
  },
});

export const setConversationState = defineTool({
  name: 'set_conversation_state',
  description: 'Save the orchestrator state for the current conversation.',
  module: 'core',
  input: z.object({ state: z.record(z.any()) }),
  allow: [...AGENTS, 'system'],
  async run({ db, ctx }, { state }) {
    if (!ctx.conversationId) throw new ToolError('no_conversation', 'No active conversation');
    await db.query('UPDATE conversations SET state=$2 WHERE id=$1', [
      ctx.conversationId,
      JSON.stringify(state),
    ]);
    return { ok: true };
  },
});

export const deskTools = [
  receiveCallMessage,
  receiveMessage,
  setConversationState,
  getClinicInfo,
  flagToReceptionist,
  raiseRedFlag,
  resolveFlag,
  handoffToHuman,
  takeOverConversation,
  sendMessage,
  getIntakeQuestions,
  saveIntake,
  getPatientHistory,
];
