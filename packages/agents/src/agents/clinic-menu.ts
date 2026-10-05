import { classifyIntent, parseChoice } from '../intent';
import { call, say, setState, type Turn } from '../turn';
import { frontDesk, startBooking } from './frontdesk';
import { leads } from './leads';

/** Product-owned flow. Clinic data supplies schedules, never the conversation logic. */
export async function clinicMenu(turn: Turn): Promise<boolean> {
  const flow = turn.state.flow;
  const greeting =
    !flow &&
    (classifyIntent(turn.text) === 'greeting' || /^(menu|मेन्यू)$/i.test(turn.text.trim()));
  if (!greeting && flow !== 'clinic_menu' && flow !== 'clinic_visit' && !turn.state.managedBooking)
    return false;
  const info = await call(turn, 'system', 'get_clinic_info', {});
  if (info.agents?.front_desk === false || (!turn.patientId && info.agents?.leads === false)) {
    await call(turn, 'system', 'handoff_to_human', {
      reason: 'other',
      summary: 'Clinic booking assistant is paused.',
    });
    await say(turn, 'system', 'msg.human_handoff');
    return true;
  }
  if (!greeting && flow !== 'clinic_menu' && flow !== 'clinic_visit') return false;
  if (greeting) {
    await setState(turn, 'front_desk', { flow: 'clinic_menu', flowVersion: 1 });
    await say(turn, 'front_desk', 'msg.clinic_menu', { clinic: info.clinic });
    return true;
  }
  if (flow === 'clinic_menu') {
    const choice = parseChoice(turn.text, 4),
      intent = classifyIntent(turn.text);
    if (choice === 1 || intent === 'book' || intent === 'yes') {
      await setState(turn, 'front_desk', { flow: 'clinic_visit', flowVersion: 1 });
      await say(turn, 'front_desk', 'msg.clinic_visit');
      return true;
    }
    if (choice === 2 || intent === 'timings') {
      await frontDesk(turn, 'timings');
      return true;
    }
    if (choice === 3 || intent === 'address') {
      await frontDesk(turn, 'address');
      return true;
    }
    if (choice === 4) {
      await call(turn, 'system', 'handoff_to_human', {
        reason: 'human_requested',
        summary: 'Patient selected reception from the clinic menu.',
      });
      await say(turn, 'system', 'msg.human_handoff');
      return true;
    }
    await say(turn, 'front_desk', 'msg.clinic_menu', { clinic: info.clinic });
    return true;
  }
  const choice = parseChoice(turn.text, 2);
  const kind =
    choice === 1 || /^(first|new|पहली)/i.test(turn.text.trim())
      ? 'first_visit'
      : choice === 2 || /^(follow[ -]?up|return|फॉलो)/i.test(turn.text.trim())
        ? 'follow_up'
        : null;
  if (!kind) {
    await say(turn, 'front_desk', 'msg.clinic_visit');
    return true;
  }
  await setState(turn, 'front_desk', { managedBooking: true, visitKind: kind, flowVersion: 1 });
  if (turn.patientId) await startBooking(turn);
  else await leads(turn, 'book');
  return true;
}
