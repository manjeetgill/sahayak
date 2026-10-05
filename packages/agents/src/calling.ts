import { callTool } from '@sahayak/core';
import { withClinic } from '@sahayak/db';
import { t } from '@sahayak/shared';
import { call, say, type AgentEnv, type Turn } from './turn';
import { checkRedFlag, isMedicalQuestion, wantsHuman, isUpset } from './safety';
import { classifyIntent } from './intent';
import { clinicMenu } from './agents/clinic-menu';
import { continueLead } from './agents/leads';
import { continueFlow, frontDesk } from './agents/frontdesk';

/** Restricted inbound calling. Caller ID never authenticates staff or unlocks previous records. */
export async function handleCallTurn(
  env: AgentEnv,
  i: {
    clinicId: string;
    callId: string;
    agentId: string;
    caller: string;
    text: string;
    language: 'en' | 'hi';
  },
) {
  const c = await callTool(
    env.rt,
    { clinicId: i.clinicId, actor: { kind: 'system' } },
    'receive_call_message',
    { callId: i.callId, agentId: i.agentId, text: i.text, language: i.language },
  );
  const turn: Turn = {
    env,
    clinicId: i.clinicId,
    conversationId: c.conversationId,
    patientId: c.patientId,
    contact: i.caller,
    channel: 'voice',
    lang: c.language,
    text: i.text,
    state: c.state,
    replies: [],
  };
  if (['clinic_menu', 'clinic_visit', 'pick_doctor', 'pick_slot'].includes(turn.state.flow)) {
    const words: Record<string, string> = {
      one: '1',
      two: '2',
      three: '3',
      four: '4',
      five: '5',
      six: '6',
      seven: '7',
      eight: '8',
      nine: '9',
      एक: '1',
      दो: '2',
      तीन: '3',
      चार: '4',
      पाँच: '5',
      पांच: '5',
    };
    const spoken = turn.text
      .trim()
      .toLowerCase()
      .replace(/[.!।]$/, '');
    turn.text = words[spoken] ?? turn.text;
  }
  let action: 'continue' | 'end' | 'handoff' = 'continue';
  const reception = async () => {
    await call(turn, 'system', 'handoff_to_human', {
      reason: 'human_requested',
      summary: 'Inbound caller needs reception assistance; no live transfer.',
    });
    await say(turn, 'system', 'msg.voice_reception');
    action = 'handoff';
  };
  const phrases = await withClinic(
    env.rt.pool,
    i.clinicId,
    async (db) => (await db.query('SELECT phrase FROM red_flag_phrases')).rows,
  );
  const rf = await checkRedFlag(env.gate, i.text, phrases);
  if (rf.hit) {
    await call(turn, 'system', 'raise_red_flag', {
      topic: rf.topic ?? 'unspecified',
      source: rf.source ?? 'keywords',
      excerpt: i.text.slice(0, 300),
    });
    await say(turn, 'system', 'msg.red_flag');
    action = 'handoff';
  } else if (c.handledBy === 'human') {
    turn.replies.push(t(turn.lang, 'msg.voice_reception'));
    action = 'handoff';
  } else if (wantsHuman(i.text) || isUpset(i.text)) await reception();
  else if (isMedicalQuestion(i.text)) {
    await call(turn, 'system', 'flag_to_receptionist', {
      kind: 'medical_question',
      summary: 'Inbound caller asked a medical question; no medical advice given.',
    });
    await say(turn, 'system', 'msg.medical_advice');
    action = 'handoff';
  } else {
    const intent = classifyIntent(i.text);
    // No cancellation, history, staff tools, privacy deletion or reminder changes by caller ID.
    if (
      ['cancel', 'reschedule', 'queue_status'].includes(intent) ||
      /\b(stop|delete|erase|records?|prescription|report|staff)\b|मिटा|रिकॉर्ड/i.test(i.text)
    )
      await reception();
    else {
      const info = await call(turn, 'system', 'get_clinic_info', {});
      if (info.agents?.front_desk === false || info.agents?.leads === false) await reception();
      else if (await clinicMenu(turn)) {
        /* common clinic menu */
      } else if (turn.state.flow?.startsWith('lead_')) await continueLead(turn);
      else if (
        ['pick_doctor', 'ask_pref', 'pick_slot', 'confirm_clinic_slot'].includes(turn.state.flow)
      ) {
        await continueFlow(turn);
        if (!turn.state.flow) action = 'end';
      } else if (intent === 'timings' || intent === 'address') await frontDesk(turn, intent);
      else if (intent === 'thanks') {
        await say(turn, 'system', 'msg.voice_reception');
        action = 'end';
      } else {
        // Booking always starts with first visit / follow-up, even when requested directly.
        turn.text = 'Hi';
        await clinicMenu(turn);
      }
      if (turn.replies.includes(t(turn.lang, 'msg.human_handoff'))) action = 'handoff';
    }
  }
  return {
    action,
    text: turn.replies.join(' ').replace(/\*/g, '') || t(turn.lang, 'msg.voice_reception'),
    conversationId: c.conversationId,
  };
}
