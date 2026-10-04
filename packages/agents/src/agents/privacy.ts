import { normalise } from '@sahayak/shared';
import { call, say, setState, type Turn } from '../turn';

const AGENT = 'front_desk';
export type PrivacyRequest = 'stop' | 'start' | 'my_data' | 'delete_data';

/** STOP/START and "my data" / "delete my data" requests, in English, Hinglish and Hindi. */
export function detectPrivacyRequest(text: string): PrivacyRequest | null {
  const n = normalise(text);
  if (
    /^(stop|unsubscribe|opt ?out|stop all|stop messages?|stop reminders?)\.?!?$/.test(n) ||
    /\b(don'?t|do not|dont) (send|message|text) me\b|\bmat bhejo\b|\bmessage (band|mat)\b|मैसेज बंद|संदेश बंद|मैसेज मत/.test(
      n,
    )
  )
    return 'stop';
  if (/^(start|subscribe|resume)\.?!?$/.test(n)) return 'start';
  if (
    /\b(delete|erase|remove|wipe)\b.{0,25}\b(my )?(data|details|records?|information|chat|history)\b|\bforget me\b|\bmera data (delete|hata|mita)|डेटा (हटा|डिलीट|मिटा)|मेरा (डेटा|रिकॉर्ड) (हटा|मिटा|डिलीट)/.test(
      n,
    )
  )
    return 'delete_data';
  if (
    /\b(my data|what data|data (do you|you) (have|hold|store|keep)|export my|copy of my (data|records?)|mera data|meri jankari)\b|मेरा डेटा|मेरी जानकारी/.test(
      n,
    )
  )
    return 'my_data';
  return null;
}

/** Returns true if the message was handled here. After an erasure nothing else may touch the (deleted) chat. */
export async function handlePrivacy(turn: Turn, req: PrivacyRequest): Promise<boolean> {
  const info = await call(turn, AGENT, 'get_clinic_info', {});
  if (req === 'delete_data') {
    await setState(turn, AGENT, { flow: 'erase_confirm' });
    await say(turn, AGENT, 'msg.confirm_erase');
    return true;
  }
  if (req === 'my_data') {
    if (!turn.patientId) {
      await say(turn, AGENT, 'msg.no_data_held');
      return true;
    }
    const d = await call(turn, AGENT, 'get_my_data', { patientId: turn.patientId });
    await say(turn, AGENT, 'msg.my_data', {
      name: d.name,
      phone: d.phone,
      visits: d.visits,
      appointments: d.appointments,
      messages: d.messages,
      consents: d.consents.length ? d.consents.join(', ') : '-',
    });
    return true;
  }
  if (!turn.patientId) {
    await say(turn, AGENT, 'msg.no_data_held');
    return true;
  }
  if (req === 'stop') {
    await call(turn, AGENT, 'withdraw_messaging', { patientId: turn.patientId });
    await say(turn, AGENT, 'msg.stopped', { clinic: info.clinic });
  } else {
    for (const purpose of ['whatsapp_messaging', 'reminders_followups'])
      await call(turn, AGENT, 'record_consent', {
        patientId: turn.patientId,
        purpose,
        granted: true,
      });
    await say(turn, AGENT, 'msg.started');
  }
  return true;
}

/** Second step of the erase flow. Anything except DELETE cancels. */
export async function continueErase(turn: Turn): Promise<void> {
  if (
    /^\s*delete( my data)?\s*[.!]?\s*$/i.test(turn.text) ||
    /^\s*(डिलीट|मिटाओ|हटाओ)\s*$/.test(turn.text)
  ) {
    const out = await call(turn, AGENT, 'erase_patient_data', { patientId: turn.patientId });
    turn.replies.push(out.text); // chat history is gone: reply is delivered, not stored
    return;
  }
  await setState(turn, AGENT, {});
  await say(turn, AGENT, 'msg.erase_cancelled');
}
