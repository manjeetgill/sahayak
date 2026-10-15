import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { withClinic } from '@sahayak/db';
import { handleCallTurn, type AgentEnv } from '@sahayak/agents';
import { MockWhatsAppChannel } from '@sahayak/core';

const Bindings = z.record(
  z.string().uuid(),
  z
    .object({
      clinicId: z.string().uuid(),
      appId: z.string().uuid(),
      secret: z.string().min(32),
      requestedNumber: z
        .string()
        .regex(/^\+[1-9]\d{7,14}$/)
        .optional(),
    })
    .strict(),
);
export type CallingBridgeOptions = z.infer<typeof Bindings>;
export function callingBridgeFromEnv(env = process.env): CallingBridgeOptions | undefined {
  try {
    return Bindings.parse(JSON.parse(env.AGENT_CALLING_BRIDGE_BINDINGS ?? '{}'));
  } catch {
    return undefined;
  } // Misconfigured calling must not prevent the main app starting.
}
const base = {
  event_id: z.string().uuid(),
  agent_id: z.string().uuid(),
  app_id: z.string().uuid(),
};
const Input = z.discriminatedUnion('probe', [
  z.object({ ...base, probe: z.literal(true) }).strict(),
  z
    .object({
      ...base,
      probe: z.literal(false),
      call_id: z.string().uuid(),
      caller: z.string().regex(/^\+[1-9]\d{7,14}$/),
      input: z.string().min(1).max(2000),
      input_trust: z.literal('untrusted_caller_data'),
      turn: z.number().int().min(1).max(30),
      language: z.enum(['en-IN', 'en-US', 'hi-IN']),
    })
    .strict(),
]);
// Internet voice carries an app-authenticated caller UUID, never a telephone caller ID.
const WebInput = z.object({
  ...base, session_id: z.string().uuid(), user_id: z.string().uuid(),
  caller_phone: z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),
  input: z.string().min(1).max(1500), input_trust: z.literal('untrusted_speech'),
  turn: z.number().int().min(1).max(15), channel: z.literal('web_voice'),
  language: z.enum(['auto','en','hi','hinglish']),
  conversation: z.array(z.object({role:z.enum(['user','assistant']),text:z.string().max(1500)}).strict()).max(8),
}).strict();
export function installCallingBridge(
  app: FastifyInstance,
  env: AgentEnv,
  bindings: CallingBridgeOptions = {},
) {
  for (const route of ['/integrations/agent-platform/calling','/integrations/agent-platform/voice']) {
  app.post(route, { bodyLimit: 20000 }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    let i: z.infer<typeof Input>;
    if (route.endsWith('/voice')) {
      const parsed = WebInput.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({error:'Invalid internet voice event'});
      const w=parsed.data;
      i={probe:false,event_id:w.event_id,agent_id:w.agent_id,app_id:w.app_id,
         call_id:w.session_id,caller:w.caller_phone ?? '',input:w.input,
         input_trust:'untrusted_caller_data',turn:w.turn,
         language:w.language==='hi'||w.language==='hinglish'?'hi-IN':'en-IN'};
    } else {
      const parsed = Input.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({error:'Invalid calling event'});
      i=parsed.data;
    }
    const binding = bindings[i.agent_id];
    const stamp = req.headers['x-agent-timestamp'],
      signature = req.headers['x-agent-signature'];
    const raw = (req as unknown as { rawBody: string }).rawBody;
    if (
      !binding ||
      binding.appId !== i.app_id ||
      typeof raw !== 'string' ||
      typeof stamp !== 'string' ||
      !/^\d{10}$/.test(stamp) ||
      Math.abs(Date.now() / 1000 - Number(stamp)) > 300 ||
      typeof signature !== 'string' ||
      !/^[a-f0-9]{64}$/.test(signature)
    )
      return reply.code(403).send({ error: 'Invalid calling authentication' });
    const expected = createHmac('sha256', binding.secret)
      .update(stamp + '.' + raw)
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
      return reply.code(403).send({ error: 'Invalid calling authentication' });
    if (!i.probe && !i.caller) return {event_id:i.event_id,action:'handoff',text:'Please add your contact phone number in the clinic app before starting an appointment call. This number does not grant access to existing patient records.'};
    if (i.probe) {
      const ready = await withClinic(env.rt.pool, binding.clinicId, async (db) => {
        await db.query('SELECT 1 FROM calling_sessions LIMIT 1');
        await db.query('SELECT 1 FROM agent_platform_receipts LIMIT 1');
        return (await db.query('SELECT 1 FROM clinics WHERE id=$1', [binding.clinicId])).rowCount;
      });
      return ready
        ? { ready: true, event_id: i.event_id }
        : reply.code(409).send({ error: 'Clinic unavailable' });
    }
    const digest = createHash('sha256').update(JSON.stringify({route,...i})).digest('hex');
    const callerHash = createHmac('sha256', binding.secret).update(i.caller).digest('hex');
    const lock = await env.rt.pool.connect();
    const lockKey = binding.clinicId + ':calling:' + i.agent_id + ':' + i.call_id;
    let acquired = false;
    try {
      acquired = (
        await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [lockKey])
      ).rows[0].locked;
      if (!acquired) return reply.code(409).send({ error: 'Call busy; reconcile before retry' });
      const claimed = await withClinic(env.rt.pool, binding.clinicId, async (db) => {
        const args = [binding.clinicId, i.agent_id, i.event_id];
        const old = (
          await db.query(
            'SELECT digest,state,response FROM agent_platform_receipts WHERE clinic_id=$1 AND channel_id=$2 AND event_id=$3',
            args,
          )
        ).rows[0];
        if (old) return { old };
        if (i.turn === 1)
          await db.query(
            'INSERT INTO calling_sessions(clinic_id,agent_id,call_id,caller_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
            [binding.clinicId, i.agent_id, i.call_id, callerHash],
          );
        const session = (
          await db.query(
            'UPDATE calling_sessions SET last_turn=$5,in_flight=true WHERE clinic_id=$1 AND agent_id=$2 AND call_id=$3 AND caller_hash=$4 AND last_turn=$5-1 AND NOT ended AND NOT in_flight RETURNING call_id',
            [binding.clinicId, i.agent_id, i.call_id, callerHash, i.turn],
          )
        ).rowCount;
        if (!session) return { conflict: true };
        await db.query(
          "INSERT INTO agent_platform_receipts(clinic_id,channel_id,event_id,digest,state) VALUES($1,$2,$3,$4,'PROCESSING')",
          [...args, digest],
        );
        return { fresh: true };
      });
      if (claimed.old) {
        if (claimed.old.digest !== digest)
          return reply.code(409).send({ error: 'Event content changed' });
        if (claimed.old.state === 'DONE' && claimed.old.response) return claimed.old.response;
        return reply.code(409).send({ error: 'Event outcome needs reconciliation' });
      }
      if (!claimed.fresh) return reply.code(409).send({ error: 'Call ended or turn out of order' });
      try {
        const result = await handleCallTurn(
          { ...env, rt: { ...env.rt, channel: new MockWhatsAppChannel() } },
          {
            clinicId: binding.clinicId,
            callId: i.call_id,
            agentId: i.agent_id,
            caller: i.caller,
            text: i.input,
            language: i.language === 'hi-IN' ? 'hi' : 'en',
          },
        );
        if (!result.text || result.text.length > 1200) throw new Error('Invalid spoken reply');
        const response = { event_id: i.event_id, action: result.action, text: result.text };
        await withClinic(env.rt.pool, binding.clinicId, async (db) => {
          await db.query(
            "UPDATE agent_platform_receipts SET state='DONE',response=$4,conversation_id=$5 WHERE clinic_id=$1 AND channel_id=$2 AND event_id=$3",
            [
              binding.clinicId,
              i.agent_id,
              i.event_id,
              JSON.stringify(response),
              result.conversationId,
            ],
          );
          await db.query(
            'UPDATE calling_sessions SET ended=$4,in_flight=false,conversation_id=$5 WHERE clinic_id=$1 AND agent_id=$2 AND call_id=$3',
            [
              binding.clinicId,
              i.agent_id,
              i.call_id,
              result.action !== 'continue',
              result.conversationId,
            ],
          );
        });
        return response;
      } catch {
        await withClinic(env.rt.pool, binding.clinicId, async (db) => {
          await db.query(
            "UPDATE agent_platform_receipts SET state='UNKNOWN',response=NULL WHERE clinic_id=$1 AND channel_id=$2 AND event_id=$3",
            [binding.clinicId, i.agent_id, i.event_id],
          );
          await db.query(
            'UPDATE calling_sessions SET ended=true,in_flight=false WHERE clinic_id=$1 AND agent_id=$2 AND call_id=$3',
            [binding.clinicId, i.agent_id, i.call_id],
          );
        });
        return reply.code(503).send({ error: 'Call outcome needs reconciliation' });
      }
    } finally {
      try {
        if (acquired)
          await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lockKey]);
      } finally {
        lock.release();
      }
    }
  });
  }
}
