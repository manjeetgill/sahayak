import { violatesMedicalPolicy } from '../safety';
import { call, say, sayText, setState, type Turn } from '../turn';
import { withClinic } from '@sahayak/db';

const AGENT = 'intake';
type Q = { id: string; en: string; hi: string };

async function questions(turn: Turn): Promise<Q[]> {
  return (await call(turn, AGENT, 'get_intake_questions', {})).questions;
}

/** Begin intake for a checked-in patient who consented to messages. Called by the orchestrator after check-in. */
export async function startIntake(turn: Turn) {
  const qs = await questions(turn);
  if (!qs.length) return;
  await setState(turn, AGENT, { agent: 'intake', qi: 0, answers: [] });
  await say(turn, AGENT, 'msg.intake_intro');
  await sayText(turn, AGENT, qs[0][turn.lang]);
}

export async function continueIntake(turn: Turn) {
  const qs = await questions(turn);
  const st = turn.state;
  const answers = [
    ...(st.answers ?? []),
    { question: qs[st.qi].en, answer: turn.text.slice(0, 500) },
  ];
  const qi = st.qi + 1;
  if (qi < qs.length) {
    await setState(turn, AGENT, { agent: 'intake', qi, answers });
    return sayText(turn, AGENT, qs[qi][turn.lang]);
  }
  await call(turn, AGENT, 'save_intake_answers', {
    patientId: turn.patientId,
    answers,
    summary: await summarise(turn, answers),
  });
  await setState(turn, AGENT, {});
  return say(turn, AGENT, 'msg.intake_done');
}

/** Factual summary for the doctor. Never a diagnosis; falls back to the plain answers if the model misbehaves. */
async function summarise(
  turn: Turn,
  answers: { question: string; answer: string }[],
): Promise<string | undefined> {
  if (!turn.env.gate.available()) return undefined;
  try {
    const r = await turn.env.gate.chat({
      messages: [
        {
          role: 'system',
          content:
            'Summarise these intake answers for a doctor in 2-3 plain factual lines, in English. Report only what the patient said. Do NOT diagnose, suggest causes, medicines or reassurance.',
        },
        { role: 'user', content: answers.map((a) => `${a.question} -> ${a.answer}`).join('\n') },
      ],
      temperature: 0,
      maxTokens: 200,
    });
    const out = r.content?.trim();
    return out && !violatesMedicalPolicy(out) ? out : undefined;
  } catch {
    return undefined;
  }
}

/** Helper for the API: find the open conversation of a patient (by phone) so intake can start in it. */
export async function findConversation(turn: Pick<Turn, 'env' | 'clinicId'>, phone: string) {
  return withClinic(
    turn.env.rt.pool,
    turn.clinicId,
    async (db) =>
      (
        await db.query(
          "SELECT id, language FROM conversations WHERE contact=$1 AND channel='whatsapp'",
          [phone],
        )
      ).rows[0] as { id: string; language: 'en' | 'hi' } | undefined,
  );
}
