import { z } from 'zod';
import { t, type Lang } from '@sahayak/shared';
import {
  computeNextRun,
  explainSpec,
  interpretAgentRequest,
  validateSpec,
  type AgentSpec,
} from '../custom-agents';
import { defineTool, ToolError, type ToolRun } from './registry';
import { deliver, ensureConversation, getSettings, storeMessage } from './common';
import { runMetric, formatMetric, parseRange } from './ask';

const ADMIN = ['staff:admin'];
const STAFF = ['staff:admin', 'staff:doctor', 'staff:receptionist'];
const UUID = z.string().uuid();
const MAX_ACTIVE = 5;
const PER_PATIENT_DAYS = 7; // never more than one custom-agent message per patient per week
const MAX_PER_RUN = 200;

const userId = (a: any) => (a.kind === 'staff' ? a.userId : null);
function mustBeValid(raw: unknown): AgentSpec {
  const v = validateSpec(raw);
  if (!v.ok)
    throw new ToolError(
      'invalid_spec',
      v.problems.map((p) => (p.field ? `${p.field}: ${p.message}` : p.message)).join(' | '),
    );
  return v.spec;
}

/** Patients an agent may message right now. Consent, the weekly cap and erased records are enforced HERE, not by the spec. */
async function audienceQuery(
  r: ToolRun,
  spec: AgentSpec,
  opts: { patientId?: string | null; limit: number },
) {
  const a = spec.audience;
  return (
    await r.db.query(
      `SELECT p.id, p.name, p.phone, p.language FROM patients p
        WHERE p.name <> 'Erased patient' AND p.clinical_hold_until IS NULL
          AND ($1::uuid IS NULL OR p.id = $1)
          AND EXISTS (SELECT 1 FROM consents c WHERE c.patient_id=p.id AND c.purpose='whatsapp_messaging' AND c.withdrawn_at IS NULL)
          AND EXISTS (SELECT 1 FROM consents c WHERE c.patient_id=p.id AND c.purpose='reminders_followups' AND c.withdrawn_at IS NULL)
          AND ($2::text[] IS NULL OR p.tags && $2::text[])
          AND ($3::int IS NULL OR COALESCE((SELECT max(queue_date) FROM queue_entries q WHERE q.patient_id=p.id AND q.status='done'), p.created_at::date) < now()::date - $3::int)
          AND ($4::int IS NULL OR EXISTS (SELECT 1 FROM queue_entries q WHERE q.patient_id=p.id AND q.status='done' AND q.queue_date >= now()::date - $4::int))
          AND ($5::boolean IS NULL OR EXISTS (SELECT 1 FROM appointments x WHERE x.patient_id=p.id AND x.status='booked' AND x.starts_at > now()) = $5)
          AND NOT EXISTS (SELECT 1 FROM custom_agent_sends s WHERE s.patient_id=p.id AND s.sent_at > now() - make_interval(days => ${PER_PATIENT_DAYS}))
        ORDER BY p.created_at LIMIT $6`,
      [
        opts.patientId ?? null,
        a.tags?.length ? a.tags : null,
        a.lastVisitOlderThanDays ?? null,
        a.lastVisitWithinDays ?? null,
        a.hasUpcomingAppointment ?? null,
        opts.limit,
      ],
    )
  ).rows as { id: string; name: string; phone: string; language: Lang }[];
}

const pickText = (txt: { en: string; hi?: string }, lang: Lang) =>
  lang === 'hi' && txt.hi ? txt.hi : txt.en;
const render = (txt: string, vars: Record<string, string>) =>
  txt.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

async function localHour(r: ToolRun, tz: string): Promise<number> {
  return (await r.db.query('SELECT extract(hour FROM now() AT TIME ZONE $1)::int AS h', [tz]))
    .rows[0].h as number;
}

async function sendToPatient(
  r: ToolRun,
  agent: { id: string; name: string },
  p: { id: string; phone: string; language: Lang; name: string },
  text: { en: string; hi?: string },
  clinicName: string,
) {
  const { db, ctx } = r;
  const body = `${clinicName}: ${render(pickText(text, p.language), { name: p.name.split(' ')[0], clinic: clinicName })}\n${t(p.language, 'msg.custom_footer')}`;
  const conv = await ensureConversation(db, ctx.clinicId, p.phone, p.id, p.language);
  await storeMessage(db, ctx.clinicId, conv.id, 'out', 'agent:custom', body);
  await deliver(r, { to: p.phone, text: body, lang: p.language });
  await db.query(
    'INSERT INTO custom_agent_sends (clinic_id,agent_id,patient_id) VALUES ($1,$2,$3)',
    [ctx.clinicId, agent.id, p.id],
  );
  await db.query(
    "INSERT INTO agent_actions (clinic_id,patient_id,conversation_id,agent,kind,input,ok) VALUES ($1,$2,$3,$4,'message',$5,true)",
    [
      ctx.clinicId,
      p.id,
      conv.id,
      `custom:${agent.name.slice(0, 40)}`,
      JSON.stringify({ customAgentId: agent.id }),
    ],
  );
  r.emit({ type: 'conversation_updated', conversationId: conv.id });
}

async function notifyStaff(
  r: ToolRun,
  to: 'doctor' | 'receptionist' | 'both',
  text: string,
  lang: Lang,
) {
  const { db, ctx } = r;
  const roles = to === 'both' ? ['doctor', 'receptionist'] : [to];
  const f = await db.query(
    "INSERT INTO flags (clinic_id,kind,severity,summary) VALUES ($1,'system','normal',$2) RETURNING id",
    [ctx.clinicId, text.slice(0, 480)],
  );
  r.emit({ type: 'flag_raised', flagId: f.rows[0].id, severity: 'normal' });
  const staff = (
    await db.query('SELECT phone FROM staff_users WHERE phone IS NOT NULL AND role = ANY($1)', [
      roles,
    ])
  ).rows;
  for (const u of staff) {
    const conv = await ensureConversation(db, ctx.clinicId, u.phone, null, lang);
    await storeMessage(db, ctx.clinicId, conv.id, 'out', 'agent:custom', text);
    await deliver(r, { to: u.phone, text, lang });
  }
  return staff.length;
}

async function execute(
  r: ToolRun,
  agent: { id: string; name: string; spec: AgentSpec },
  run: { patient_id: string | null },
  tz: string,
  clinicName: string,
  lang: Lang,
) {
  const { db } = r;
  const a = agent.spec.action;
  if (a.type === 'message_patients') {
    const people = await audienceQuery(r, agent.spec, {
      patientId: run.patient_id,
      limit: run.patient_id ? 1 : MAX_PER_RUN,
    });
    for (const p of people) await sendToPatient(r, agent, p, a.text, clinicName);
    return { sent: people.length };
  }
  if (a.type === 'notify_staff') {
    let who = '';
    if (run.patient_id)
      who =
        ((await db.query('SELECT name FROM patients WHERE id=$1', [run.patient_id])).rows[0]
          ?.name as string) ?? 'A patient';
    const text = render(a.text.en, { name: who, clinic: clinicName, count: '1', names: who });
    return { notified: await notifyStaff(r, a.to, text, lang) };
  }
  // summary: today's numbers for each doctor who gave a phone number
  const today = (await db.query("SELECT to_char(now() AT TIME ZONE $1,'YYYY-MM-DD') d", [tz]))
    .rows[0].d as string;
  const docs = (
    await db.query(
      "SELECT doctor_id, phone FROM staff_users WHERE role='doctor' AND phone IS NOT NULL",
    )
  ).rows;
  for (const d of docs) {
    const lines: string[] = [];
    for (const m of a.metrics)
      lines.push(
        formatMetric(
          lang,
          m,
          parseRange('today', today),
          await runMetric(db, r.ctx.clinicId, m, today, today, d.doctor_id),
        ),
      );
    const text = `${agent.name}\n${lines.join('\n')}`;
    const conv = await ensureConversation(db, r.ctx.clinicId, d.phone, null, lang);
    await storeMessage(db, r.ctx.clinicId, conv.id, 'out', 'agent:custom', text);
    await deliver(r, { to: d.phone, text, lang });
  }
  return { sentTo: docs.length };
}

export const interpretRequest = defineTool({
  name: 'interpret_agent_request',
  description:
    'Turn a plain-language request into a PROPOSED agent. Nothing runs until the doctor reviews and activates it.',
  module: 'core',
  input: z.object({ text: z.string().trim().min(5).max(500) }),
  allow: ADMIN,
  async run(_r, { text }) {
    const i = interpretAgentRequest(text);
    if (!i.understood) return { understood: false, help: i.help, notes: i.notes };
    const v = validateSpec(i.spec);
    return {
      understood: true,
      name: i.name,
      spec: v.ok ? v.spec : i.spec,
      problems: v.ok ? [] : v.problems,
      explain: v.ok ? explainSpec(v.spec) : [],
      notes: i.notes,
    };
  },
});

export const previewCustomAgent = defineTool({
  name: 'preview_custom_agent',
  description:
    'Show exactly what an agent would do, and how many patients it would reach right now. Sends nothing.',
  module: 'core',
  input: z.object({ spec: z.any() }),
  allow: ADMIN,
  async run(r, { spec: raw }) {
    const v = validateSpec(raw);
    if (!v.ok) return { valid: false, problems: v.problems };
    const spec = v.spec;
    const s = await getSettings(r.db, r.ctx.clinicId);
    const out: Record<string, unknown> = { valid: true, explain: explainSpec(spec), problems: [] };
    if (spec.action.type === 'message_patients') {
      const people = await audienceQuery(r, spec, { limit: MAX_PER_RUN });
      out.audience = {
        count: people.length,
        sample: people.slice(0, 5).map((p) => p.name.split(' ')[0]),
        cappedAt: MAX_PER_RUN,
      };
      out.example = `${s.clinic_name}: ${render(spec.action.text.en, { name: people[0]?.name.split(' ')[0] ?? 'Asha', clinic: s.clinic_name })}\n${t('en', 'msg.custom_footer')}`;
    }
    out.nextRun = (await computeNextRun(r.db, s.timezone, spec.trigger))?.toISOString() ?? null;
    return out;
  },
});

export const createCustomAgent = defineTool({
  name: 'create_custom_agent',
  description: 'Save a custom agent as a draft. It does nothing until a doctor activates it.',
  module: 'core',
  input: z.object({
    name: z.string().trim().min(3).max(80),
    description: z.string().trim().max(500).default(''),
    spec: z.any(),
    platformDraftId: UUID.optional(),
    platformVersion: z.number().int().positive().optional(),
  }),
  allow: ADMIN,
  auditInput: (i) => ({ name: i.name }),
  async run({ db, ctx }, i) {
    if ((i.platformDraftId === undefined) !== (i.platformVersion === undefined))
      throw new ToolError('invalid_source', 'Platform draft id and version must be provided together');
    const spec = mustBeValid(i.spec);
    const r = await db.query(
      'INSERT INTO custom_agents (clinic_id,name,description,spec,created_by,platform_draft_id,platform_version) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [ctx.clinicId, i.name, i.description, JSON.stringify(spec), userId(ctx.actor), i.platformDraftId ?? null, i.platformVersion ?? null],
    );
    return { agentId: r.rows[0].id as string };
  },
});

export const updateCustomAgent = defineTool({
  name: 'update_custom_agent',
  description:
    'Change an agent. Any change sets it back to draft: the doctor must review and activate it again.',
  module: 'core',
  input: z.object({
    agentId: UUID,
    name: z.string().trim().min(3).max(80).optional(),
    spec: z.any().optional(),
  }),
  allow: ADMIN,
  auditInput: (i) => ({ agentId: i.agentId }),
  async run({ db }, i) {
    const spec = i.spec !== undefined ? mustBeValid(i.spec) : null;
    const u = await db.query(
      "UPDATE custom_agents SET name=COALESCE($2,name), spec=COALESCE($3,spec), platform_draft_id=CASE WHEN $3::jsonb IS NOT NULL THEN NULL ELSE platform_draft_id END, platform_version=CASE WHEN $3::jsonb IS NOT NULL THEN NULL ELSE platform_version END, status='draft', next_run_at=NULL, activated_at=NULL, updated_at=now() WHERE id=$1 RETURNING id",
      [i.agentId, i.name ?? null, spec ? JSON.stringify(spec) : null],
    );
    if (!u.rowCount) throw new ToolError('not_found', 'Agent not found', 404);
    await db.query(
      "UPDATE agent_runs SET status='skipped', result='{\"reason\":\"agent edited\"}' WHERE agent_id=$1 AND status='pending'",
      [i.agentId],
    );
    return { ok: true, status: 'draft' };
  },
});

export const activateCustomAgent = defineTool({
  name: 'activate_custom_agent',
  description: 'The doctor approves an agent: it starts running on its schedule or events.',
  module: 'core',
  input: z.object({ agentId: UUID }),
  allow: ADMIN,
  auditInput: (i) => ({ agentId: i.agentId }),
  async run({ db, ctx }, { agentId }) {
    const a = (await db.query('SELECT * FROM custom_agents WHERE id=$1 FOR UPDATE', [agentId]))
      .rows[0];
    if (!a) throw new ToolError('not_found', 'Agent not found', 404);
    const spec = mustBeValid(a.spec);
    const active = (
      await db.query("SELECT count(*)::int n FROM custom_agents WHERE status='active' AND id<>$1", [
        agentId,
      ])
    ).rows[0].n as number;
    if (active >= MAX_ACTIVE)
      throw new ToolError(
        'too_many_agents',
        `At most ${MAX_ACTIVE} agents can be active at once. Pause one first.`,
      );
    const s = await getSettings(db, ctx.clinicId);
    const next = await computeNextRun(db, s.timezone, spec.trigger);
    await db.query(
      "UPDATE custom_agents SET status='active', activated_at=now(), activated_by=$2, next_run_at=$3, updated_at=now() WHERE id=$1",
      [agentId, userId(ctx.actor), next],
    );
    return { ok: true, nextRunAt: next?.toISOString() ?? null };
  },
});

export const pauseCustomAgent = defineTool({
  name: 'pause_custom_agent',
  description:
    'Stop an agent right away. Pending runs are cancelled. Anyone on staff can pause; only a doctor can resume.',
  module: 'core',
  input: z.object({ agentId: UUID }),
  allow: STAFF,
  auditInput: (i) => ({ agentId: i.agentId }),
  async run({ db }, { agentId }) {
    const u = await db.query(
      "UPDATE custom_agents SET status='paused', next_run_at=NULL, updated_at=now() WHERE id=$1 AND status='active' RETURNING id",
      [agentId],
    );
    if (!u.rowCount) throw new ToolError('not_found', 'No active agent with that id', 404);
    await db.query(
      "UPDATE agent_runs SET status='skipped', result='{\"reason\":\"paused\"}' WHERE agent_id=$1 AND status='pending'",
      [agentId],
    );
    return { ok: true };
  },
});

export const resumeCustomAgent = defineTool({
  name: 'resume_custom_agent',
  description: 'A doctor resumes a paused agent.',
  module: 'core',
  input: z.object({ agentId: UUID }),
  allow: ADMIN,
  auditInput: (i) => ({ agentId: i.agentId }),
  async run({ db, ctx }, { agentId }) {
    const a = (
      await db.query("SELECT spec FROM custom_agents WHERE id=$1 AND status='paused'", [agentId])
    ).rows[0];
    if (!a) throw new ToolError('not_found', 'No paused agent with that id', 404);
    const spec = mustBeValid(a.spec);
    if (
      ((await db.query("SELECT count(*)::int n FROM custom_agents WHERE status='active'")).rows[0]
        .n as number) >= MAX_ACTIVE
    )
      throw new ToolError('too_many_agents', `At most ${MAX_ACTIVE} agents can be active at once.`);
    const next = await computeNextRun(
      db,
      (await getSettings(db, ctx.clinicId)).timezone,
      spec.trigger,
    );
    await db.query(
      "UPDATE custom_agents SET status='active', next_run_at=$2, updated_at=now() WHERE id=$1",
      [agentId, next],
    );
    return { ok: true };
  },
});

export const deleteCustomAgent = defineTool({
  name: 'delete_custom_agent',
  description: 'Delete an agent and its run history.',
  module: 'core',
  input: z.object({ agentId: UUID }),
  allow: ADMIN,
  auditInput: (i) => ({ agentId: i.agentId }),
  async run({ db }, { agentId }) {
    const d = await db.query('DELETE FROM custom_agents WHERE id=$1 RETURNING id', [agentId]);
    if (!d.rowCount) throw new ToolError('not_found', 'Agent not found', 404);
    return { ok: true };
  },
});

export const listCustomAgents = defineTool({
  name: 'list_custom_agents',
  description: 'Custom agents, what each will do, and recent runs.',
  module: 'core',
  scope: 'read',
  input: z.object({}),
  allow: STAFF,
  async run({ db }) {
    const agents = (
      await db.query(
        'SELECT id, name, description, spec, status, created_at, activated_at, next_run_at, last_run_at, run_count, platform_draft_id, platform_version FROM custom_agents ORDER BY created_at DESC',
      )
    ).rows;
    const out = [];
    for (const a of agents) {
      const v = validateSpec(a.spec);
      const runs = (
        await db.query(
          'SELECT status, run_at, result FROM agent_runs WHERE agent_id=$1 ORDER BY created_at DESC LIMIT 5',
          [a.id],
        )
      ).rows;
      out.push({ ...a, explain: v.ok ? explainSpec(v.spec) : [], runs });
    }
    return { agents: out };
  },
});

/** The engine. Runs every minute: starts due scheduled agents, then executes pending runs under the fixed safety rules. */
export const runCustomAgents = defineTool({
  name: 'run_custom_agents',
  description: 'Run due custom agents.',
  module: 'core',
  input: z.object({}),
  allow: ['system'],
  async run(r) {
    const { db, ctx } = r;
    const s = await getSettings(db, ctx.clinicId);
    const tz = s.timezone;
    const due = (
      await db.query(
        "SELECT id, spec FROM custom_agents WHERE status='active' AND spec->'trigger'->>'type'='schedule' AND next_run_at <= now() FOR UPDATE SKIP LOCKED",
      )
    ).rows;
    for (const a of due) {
      await db.query('INSERT INTO agent_runs (clinic_id,agent_id) VALUES ($1,$2)', [
        ctx.clinicId,
        a.id,
      ]);
      const next = await computeNextRun(db, tz, a.spec.trigger);
      await db.query('UPDATE custom_agents SET next_run_at=$2 WHERE id=$1', [a.id, next]);
    }
    const runs = (
      await db.query(
        `SELECT r.id, r.patient_id, a.id AS agent_id, a.name, a.spec, a.status FROM agent_runs r JOIN custom_agents a ON a.id=r.agent_id
        WHERE r.status='pending' AND r.run_at <= now() ORDER BY r.run_at LIMIT 100 FOR UPDATE OF r SKIP LOCKED`,
      )
    ).rows;
    const hour = await localHour(r, tz);
    let done = 0,
      deferred = 0,
      skipped = 0;
    for (const run of runs) {
      if (run.status !== 'active') {
        await db.query(
          'UPDATE agent_runs SET status=\'skipped\', result=\'{"reason":"agent not active"}\' WHERE id=$1',
          [run.id],
        );
        skipped++;
        continue;
      }
      const spec = validateSpec(run.spec);
      if (!spec.ok) {
        await db.query("UPDATE agent_runs SET status='failed', result=$2 WHERE id=$1", [
          run.id,
          JSON.stringify({ error: 'invalid spec' }),
        ]);
        continue;
      }
      // Quiet hours: patients are never messaged between 21:00 and 08:00.
      if (spec.spec.action.type === 'message_patients' && (hour < 8 || hour >= 21)) {
        await db.query(
          `UPDATE agent_runs SET run_at = CASE WHEN extract(hour FROM now() AT TIME ZONE $2) < 8 THEN ((now() AT TIME ZONE $2)::date + time '08:00') AT TIME ZONE $2
                                              ELSE ((now() AT TIME ZONE $2)::date + 1 + time '08:00') AT TIME ZONE $2 END WHERE id=$1`,
          [run.id, tz],
        );
        deferred++;
        continue;
      }
      try {
        const result = await execute(
          r,
          { id: run.agent_id, name: run.name, spec: spec.spec },
          run,
          tz,
          s.clinic_name,
          s.default_language,
        );
        await db.query("UPDATE agent_runs SET status='done', result=$2 WHERE id=$1", [
          run.id,
          JSON.stringify(result),
        ]);
        await db.query(
          'UPDATE custom_agents SET last_run_at=now(), run_count=run_count+1 WHERE id=$1',
          [run.agent_id],
        );
        done++;
      } catch (e) {
        await db.query("UPDATE agent_runs SET status='failed', result=$2 WHERE id=$1", [
          run.id,
          JSON.stringify({ error: String((e as Error).message).slice(0, 200) }),
        ]);
      }
    }
    return { started: due.length, done, deferred, skipped };
  },
});

export const customAgentTools = [
  interpretRequest,
  previewCustomAgent,
  createCustomAgent,
  updateCustomAgent,
  activateCustomAgent,
  pauseCustomAgent,
  resumeCustomAgent,
  deleteCustomAgent,
  listCustomAgents,
  runCustomAgents,
];
