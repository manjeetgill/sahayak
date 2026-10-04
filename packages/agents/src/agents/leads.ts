import { call, say, sayText, setState, type Turn } from '../turn';
import { parseSlotPreference } from './slotpref';
import { startBooking, frontDesk, matchFaq } from './frontdesk';
import type { Intent } from '../intent';

const AGENT = 'leads';

/** Continue the lead flow (name -> consent -> create patient -> booking). Returns true if consumed. */
export async function continueLead(turn: Turn): Promise<boolean> {
  const st = turn.state;
  if (st.flow === 'lead_name') {
    const name = turn.text.trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 60 || /\d/.test(name)) {
      await say(turn, AGENT, 'msg.ask_name');
      return true;
    }
    await setState(turn, AGENT, { flow: 'lead_consent', name, pref: st.pref });
    await say(turn, AGENT, 'msg.ask_consent_lead', { name });
    return true;
  }
  if (st.flow === 'lead_consent') {
    const yes = /^(yes|y|haan|han|ha|ji|ok|okay|हाँ|हां|जी)\b/i.test(turn.text.trim());
    if (!yes) {
      await setState(turn, AGENT, {});
      await say(turn, AGENT, 'msg.lead_declined');
      return true;
    }
    const { patientId } = await call(turn, AGENT, 'create_patient', {
      name: st.name,
      phone: turn.contact,
      language: turn.lang,
      consentVisitData: true,
    });
    turn.patientId = patientId;
    await setState(turn, AGENT, {});
    await startBooking(turn, AGENT, undefined, st.pref);
    return true;
  }
  return false;
}

/** First contact from an unknown number. Info questions are answered; booking starts the consent-first lead flow. */
export async function leads(turn: Turn, intent: Intent) {
  if (intent === 'book') {
    await setState(turn, AGENT, {
      flow: 'lead_name',
      pref:
        parseSlotPreference(turn.text, (await call(turn, AGENT, 'get_clinic_info', {})).timezone) ??
        undefined,
    });
    return say(turn, AGENT, 'msg.ask_name');
  }
  if (intent === 'greeting' || intent === 'other') {
    const info = await call(turn, AGENT, 'get_clinic_info', {});
    const faq = intent === 'other' ? matchFaq(info.faqs, turn.text) : null;
    if (faq) return sayText(turn, AGENT, faq[turn.lang]);
    return say(turn, AGENT, 'msg.lead_welcome', {
      clinic: info.clinic,
      doctor: info.doctors[0]?.name ?? '',
    });
  }
  return frontDesk(turn, intent);
}
