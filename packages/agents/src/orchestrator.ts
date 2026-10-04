import { auditEvent, callTool } from '@sahayak/core';
import { withClinic } from '@sahayak/db';
import { t } from '@sahayak/shared';
import { frontDesk, continueFlow } from './agents/frontdesk';
import { continueIntake, findConversation, startIntake } from './agents/intake';
import { continueLead, leads } from './agents/leads';
import { queueStatus, refuseReorder } from './agents/queue';
import { continueSchedule } from './agents/schedule';
import { continueFollowup } from './agents/followup';
import { classifyIntent } from './intent';
import {
  checkRedFlag,
  detectLang,
  isMedicalQuestion,
  isUpset,
  wantsHuman,
  wantsQueueJump,
} from './safety';
import { call, ctxFor, say, setState, type AgentEnv, type Turn } from './turn';

export interface InboundResult {
  replies: string[];
  handledBy: 'agent' | 'human';
  redFlag: boolean;
  conversationId: string;
}

/**
 * One shared orchestrator for every patient conversation. Order of business for each message:
 *  1. store it   2. human-owned? stop   3. red-flag check (always first)   4. human handoff / upset
 *  5. medical question -> fixed reply   6. route to the right agent
 * If anything throws, the patient gets a safe fallback and the receptionist is flagged.
 */
export async function handleInbound(
  env: AgentEnv,
  input: {
    clinicId: string;
    from: string;
    text: string;
    channel?: 'whatsapp' | 'voice';
    language?: 'en' | 'hi';
  },
): Promise<InboundResult> {
  const { rt } = env;
  const sys = { clinicId: input.clinicId, actor: { kind: 'patient' } as const };
  const lang = input.language ?? (/[ऀ-ॿ]/.test(input.text) ? ('hi' as const) : undefined);
  const rec = await callTool(rt, sys, 'receive_message', {
    from: input.from,
    text: input.text,
    language: lang,
    channel: input.channel ?? 'whatsapp',
  });
  const turn: Turn = {
    env,
    clinicId: input.clinicId,
    conversationId: rec.conversationId,
    patientId: rec.patientId,
    contact: input.from,
    lang: detectLang(input.text, rec.language),
    text: input.text,
    state: rec.state,
    replies: [],
  };
  const result = (redFlag = false): InboundResult => ({
    replies: turn.replies,
    handledBy: rec.handledBy,
    redFlag,
    conversationId: turn.conversationId,
  });

  if (rec.handledBy === 'human') return result();

  try {
    // Layer-1 + layer-2 red flag detection on every message, before anything else replies.
    const phrases = await withClinic(
      rt.pool,
      turn.clinicId,
      async (db) =>
        (await db.query('SELECT phrase FROM red_flag_phrases')).rows as { phrase: string }[],
    );
    const rf = await checkRedFlag(env.gate, turn.text, phrases);
    if (rf.hit) {
      await call(turn, 'system', 'raise_red_flag', {
        topic: rf.topic ?? 'unspecified',
        source: rf.source ?? 'keywords',
        excerpt: turn.text.slice(0, 300),
      });
      await auditEvent(rt, ctxFor(turn, 'system'), 'red_flag', {
        topic: rf.topic,
        source: rf.source,
      });
      await say(turn, 'system', 'msg.red_flag');
      return result(true);
    }

    if (wantsHuman(turn.text) || isUpset(turn.text)) {
      const reason = wantsHuman(turn.text) ? 'human_requested' : 'upset';
      await call(turn, 'system', 'handoff_to_human', {
        reason,
        summary: `Patient ${reason === 'upset' ? 'seems upset' : 'asked for a person'}: "${turn.text.slice(0, 200)}"`,
      });
      await say(turn, 'system', 'msg.human_handoff');
      rec.handledBy = 'human';
      return result();
    }

    if (isMedicalQuestion(turn.text)) {
      await call(turn, 'system', 'flag_to_receptionist', {
        kind: 'medical_question',
        summary: `Medical question (no advice given): "${turn.text.slice(0, 200)}"`,
      });
      await say(turn, 'system', 'msg.medical_advice');
      if (turn.state.agent === 'intake') await continueIntake(turn); // their words still go to the doctor as an answer
      return result();
    }

    if (wantsQueueJump(turn.text)) {
      await refuseReorder(turn);
      return result();
    }

    // Continue whatever the conversation was doing.
    if (turn.state.agent === 'intake' && turn.patientId) {
      await continueIntake(turn);
      return result();
    }
    if (turn.state.flow?.startsWith('lead_') && (await continueLead(turn))) return result();
    if (turn.state.flow?.startsWith('late_') && turn.patientId && (await continueSchedule(turn)))
      return result();
    if (
      turn.state.flow?.startsWith('followup_') &&
      turn.patientId &&
      (await continueFollowup(turn))
    )
      return result();
    if (turn.state.flow && turn.patientId && (await continueFlow(turn))) return result();
    if (turn.state.flow) await setState(turn, 'system', {}); // message did not fit the flow: drop it and treat as new

    const intent = classifyIntent(turn.text);
    // The doctor can switch agents off in the agent builder; a switched-off agent hands the chat to a person.
    const agents: Record<string, boolean> =
      (await call(turn, 'system', 'get_clinic_info', {})).agents ?? {};
    const target = !turn.patientId ? 'leads' : intent === 'queue_status' ? 'queue' : 'front_desk';
    if (agents[target] === false) {
      await call(turn, 'system', 'handoff_to_human', {
        reason: 'other',
        summary: `The ${target} agent is switched off. Patient said: "${turn.text.slice(0, 200)}"`,
      });
      await say(turn, 'system', 'msg.human_handoff');
      rec.handledBy = 'human';
      return result();
    }
    if (target === 'leads') await leads(turn, intent);
    else if (target === 'queue') await queueStatus(turn);
    else await frontDesk(turn, intent);
    return result();
  } catch (e) {
    await auditEvent(rt, ctxFor(turn, 'system'), 'error', { message: (e as Error).message }).catch(
      () => {},
    );
    if (!turn.replies.length) {
      await call(turn, 'system', 'flag_to_receptionist', {
        kind: 'system',
        summary: `Agent error, please reply manually: ${(e as Error).message.slice(0, 150)}`,
      }).catch(() => {});
      await call(turn, 'system', 'send_message', {
        conversationId: turn.conversationId,
        text: t(turn.lang, 'msg.llm_fallback'),
      }).catch(() => {});
      turn.replies.push(t(turn.lang, 'msg.llm_fallback'));
    }
    return result();
  }
}

/** After a patient with messaging consent checks in, start the intake questions in their WhatsApp chat. */
export async function startIntakeFor(
  env: AgentEnv,
  args: { clinicId: string; patientId: string; phone: string },
) {
  const conv = await findConversation({ env, clinicId: args.clinicId }, args.phone);
  if (!conv) return;
  const probe = {
    env,
    clinicId: args.clinicId,
    conversationId: conv.id,
    patientId: args.patientId,
    contact: args.phone,
    lang: conv.language,
    text: '',
    state: {},
    replies: [],
  } as Turn;
  if (((await call(probe, 'system', 'get_clinic_info', {})).agents ?? {}).intake === false) return;
  const turn: Turn = {
    env,
    clinicId: args.clinicId,
    conversationId: conv.id,
    patientId: args.patientId,
    contact: args.phone,
    lang: conv.language,
    text: '',
    state: {},
    replies: [],
  };
  await startIntake(turn);
}
