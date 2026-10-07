import type pg from 'pg';
import { z } from 'zod';
import { withClinic, type Db } from '@sahayak/db';
import type { LiveEvent, Lang } from '@sahayak/shared';
import type { EventBus } from '../events';

export type Actor =
  | {
      kind: 'staff';
      role: 'admin' | 'doctor' | 'receptionist';
      userId: string;
      doctorId?: string | null;
    }
  | { kind: 'agent'; agent: string }
  | { kind: 'api'; keyId: string; scopes: string[] }
  | { kind: 'patient' }
  | { kind: 'system'; name?: string };

/** Key used in each tool's allow-list, e.g. "staff:doctor", "agent:queue", "patient", "system". */
export function actorKey(a: Actor): string {
  return a.kind === 'staff' ? `staff:${a.role}` : a.kind === 'agent' ? `agent:${a.agent}` : a.kind;
}
export function actorLabel(a: Actor): string {
  return a.kind === 'staff'
    ? `staff:${a.userId}`
    : a.kind === 'agent'
      ? `agent:${a.agent}`
      : a.kind === 'system'
        ? `system${a.name ? ':' + a.name : ''}`
        : a.kind === 'api'
          ? `api:${a.keyId}`
          : 'patient';
}

export interface ToolContext {
  clinicId: string;
  actor: Actor;
  patientId?: string | null;
  conversationId?: string | null;
  lang?: Lang;
}
export interface ToolRuntime {
  pool: pg.Pool;
  bus: EventBus;
  /** Outbound channel adapter (WhatsApp). Defaults to the mock simulator channel. */
  channel?: import('../channels').MessagingChannel;
}
export interface ToolRun {
  db: Db;
  ctx: ToolContext;
  rt: ToolRuntime;
  emit: (e: LiveEvent) => void;
}

export interface ToolDef<I extends z.ZodTypeAny = z.ZodTypeAny, O = unknown> {
  name: string;
  description: string;
  /** Module that owns this tool. A clinic can switch the module off. */
  module: 'checkin' | 'queue' | 'appointments' | 'followups' | 'leads' | 'core';
  input: I;
  allow: string[];
  /** For API keys: minimum scope needed (read < write < admin). Defaults to write. */
  scope?: 'read' | 'write' | 'admin';
  /** What to keep in the audit log instead of the full input (clinical text must not be copied into the log). */
  auditInput?: (input: z.infer<I>) => unknown;
  /** What to keep in the audit log instead of the full output (keep personal data out of the log). */
  auditOutput?: (output: O) => unknown;
  run: (r: ToolRun, input: z.infer<I>) => Promise<O>;
}

export function defineTool<I extends z.ZodTypeAny, O>(def: ToolDef<I, O>): ToolDef<I, O> {
  return def;
}

export class ToolError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const registry = new Map<string, ToolDef<any, any>>();
export function registerTools(tools: ToolDef<any, any>[]) {
  for (const t of tools) registry.set(t.name, t);
}
export function listTools(): ToolDef<any, any>[] {
  return [...registry.values()];
}
export function getTool(name: string) {
  return registry.get(name);
}

async function audit(
  rt: ToolRuntime,
  ctx: ToolContext,
  tool: string,
  input: unknown,
  output: unknown,
  ok: boolean,
) {
  await withClinic(rt.pool, ctx.clinicId, (db) =>
    db.query(
      `INSERT INTO agent_actions (clinic_id,patient_id,conversation_id,agent,kind,tool,input,output,ok)
       VALUES ($1,$2,$3,$4,'tool_call',$5,$6,$7,$8)`,
      [
        ctx.clinicId,
        ctx.patientId ?? null,
        ctx.conversationId ?? null,
        actorLabel(ctx.actor),
        tool,
        JSON.stringify(input ?? null, (key, value) =>
          /password|secret|token/i.test(key) ? '[redacted]' : value,
        ),
        JSON.stringify(output ?? null),
        ok,
      ],
    ),
  ).catch(() => {
    /* audit failure must not mask the tool result, but is surfaced in server logs by the caller */
  });
}

/**
 * The only way an agent (or screen) changes data. Validates input, checks the actor is allowed,
 * checks the module is enabled for the clinic, runs in a clinic-scoped transaction, writes an
 * audit entry, and publishes live events after commit.
 */
export async function callTool(
  rt: ToolRuntime,
  ctx: ToolContext,
  name: string,
  rawInput: unknown,
): Promise<any> {
  const tool = registry.get(name);
  if (!tool) throw new ToolError('unknown_tool', `Unknown tool ${name}`, 404);
  if (!tool.allow.includes(actorKey(ctx.actor))) {
    await audit(rt, ctx, name, rawInput, { error: 'permission_denied' }, false);
    throw new ToolError('forbidden', `${actorKey(ctx.actor)} may not call ${name}`, 403);
  }
  if (ctx.actor.kind === 'api') {
    const rank = { read: 1, write: 2, admin: 3 } as const;
    const have = Math.max(0, ...ctx.actor.scopes.map((s) => rank[s as keyof typeof rank] ?? 0));
    if (have < rank[tool.scope ?? 'write']) {
      await audit(
        rt,
        ctx,
        name,
        rawInput,
        { error: 'permission_denied', need: tool.scope ?? 'write' },
        false,
      );
      throw new ToolError(
        'forbidden',
        `This API key needs "${tool.scope ?? 'write'}" access for ${name}`,
        403,
      );
    }
  }
  const parsed = tool.input.safeParse(rawInput);
  if (!parsed.success) {
    await audit(
      rt,
      ctx,
      name,
      rawInput,
      { error: 'invalid_input', issues: parsed.error.issues.map((i: z.ZodIssue) => i.message) },
      false,
    );
    throw new ToolError(
      'invalid_input',
      parsed.error.issues.map((i: z.ZodIssue) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
  const events: LiveEvent[] = [];
  try {
    const output = await withClinic(rt.pool, ctx.clinicId, async (db) => {
      if (tool.module !== 'core') {
        const m = await db.query('SELECT modules FROM clinic_settings WHERE clinic_id=$1', [
          ctx.clinicId,
        ]);
        if (m.rows[0] && m.rows[0].modules?.[tool.module] === false)
          throw new ToolError(
            'module_disabled',
            `Module ${tool.module} is off for this clinic`,
            403,
          );
      }
      const out = await tool.run({ db, ctx, rt, emit: (e) => events.push(e) }, parsed.data);
      await db.query(
        `INSERT INTO agent_actions (clinic_id,patient_id,conversation_id,agent,kind,tool,input,output,ok)
         VALUES ($1,$2,$3,$4,'tool_call',$5,$6,$7,true)`,
        [
          ctx.clinicId,
          ctx.patientId ?? null,
          ctx.conversationId ?? null,
          actorLabel(ctx.actor),
          name,
          JSON.stringify(tool.auditInput ? tool.auditInput(parsed.data) : parsed.data),
          JSON.stringify((tool.auditOutput ? tool.auditOutput(out) : out) ?? null),
        ],
      );
      return out;
    });
    for (const e of events) rt.bus.publish(ctx.clinicId, e);
    return output;
  } catch (e) {
    await audit(
      rt,
      ctx,
      name,
      tool.auditInput ? tool.auditInput(parsed.data) : parsed.data,
      { error: (e as Error).message },
      false,
    );
    throw e;
  }
}

/** Record a non-tool decision or message in the audit log (e.g. an agent reply, a red-flag hit). */
export async function auditEvent(
  rt: ToolRuntime,
  ctx: ToolContext,
  kind: 'message' | 'decision' | 'red_flag' | 'error',
  detail: unknown,
) {
  await withClinic(rt.pool, ctx.clinicId, (db) =>
    db.query(
      `INSERT INTO agent_actions (clinic_id,patient_id,conversation_id,agent,kind,input,ok) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        ctx.clinicId,
        ctx.patientId ?? null,
        ctx.conversationId ?? null,
        actorLabel(ctx.actor),
        kind,
        JSON.stringify(detail),
        kind !== 'error',
      ],
    ),
  );
}
