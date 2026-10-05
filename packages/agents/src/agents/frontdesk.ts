import { ToolError, fmtTime } from '@sahayak/core';
import { normalise } from '@sahayak/shared';
import { classifyIntent, parseChoice, type Intent } from '../intent';
import { violatesMedicalPolicy } from '../safety';
import { runToolLoop } from '../toolloop';
import { parseSlotPreference, todayIn, type SlotPreference } from './slotpref';
import { call, formatTimings, say, sayText, setState, type Turn } from '../turn';

const AGENT = 'front_desk';
type Info = {
  faqs?: Faq[];
  agents?: Record<string, boolean>;
  clinic: string;
  timezone: string;
  address: string | null;
  directions: string | null;
  timings: Record<string, string>;
  doctors: { id: string; name: string }[];
};
const getInfo = (turn: Turn): Promise<Info> => call(turn, AGENT, 'get_clinic_info', {});
type Faq = { keywords: string[]; en: string; hi: string };
/** Doctor-written FAQ answers (agent builder): the best-matching entry wins, by number of keywords found. */
export function matchFaq(faqs: Faq[] | undefined, text: string): Faq | null {
  const n = normalise(text);
  let best: Faq | null = null,
    bestScore = 0;
  for (const f of faqs ?? []) {
    const score = f.keywords.filter((k) => n.includes(normalise(k))).length;
    if (score > bestScore) {
      best = f;
      bestScore = score;
    }
  }
  return best;
}
const opts = (items: string[]) => items.map((x, i) => `${i + 1}) ${x}`).join('; ');

export async function startBooking(
  turn: Turn,
  agent = AGENT,
  rescheduleId?: string,
  pref?: SlotPreference,
) {
  const info = await getInfo(turn);
  // A doctor's own WhatsApp number books with that doctor; one-doctor clinics skip the question too.
  const fixed =
    info.doctors.find((d) => d.id === turn.doctorId) ??
    (info.doctors.length === 1 ? info.doctors[0] : null);
  if (fixed) return askOrOffer(turn, agent, fixed, rescheduleId, pref);
  await setState(turn, agent, {
    flow: 'pick_doctor',
    managedBooking: turn.state.managedBooking,
    visitKind: turn.state.visitKind,
    flowVersion: turn.state.flowVersion,
    doctors: info.doctors.map((d) => ({ id: d.id, name: d.name })),
    rescheduleId,
    pref,
  });
  await say(turn, agent, 'msg.pick_doctor', { options: opts(info.doctors.map((d) => d.name)) });
}

/** If the patient already said when they want to come, search; otherwise ask "which day and time?". */
export async function askOrOffer(
  turn: Turn,
  agent: string,
  doctor: { id: string; name: string },
  rescheduleId?: string,
  pref?: SlotPreference,
) {
  if (pref) return offerForPreference(turn, agent, doctor, pref, rescheduleId);
  await setState(turn, agent, {
    flow: 'ask_pref',
    managedBooking: turn.state.managedBooking,
    visitKind: turn.state.visitKind,
    flowVersion: turn.state.flowVersion,
    doctorId: doctor.id,
    doctorName: doctor.name,
    rescheduleId,
    tries: 0,
  });
  await say(turn, agent, 'msg.ask_pref', { doctor: doctor.name });
}

/** Earliest free slots (used by running-late rebooking). */
export const offerSlots = (
  turn: Turn,
  agent: string,
  doctor: { id: string; name: string },
  rescheduleId?: string,
) => offerForPreference(turn, agent, doctor, { asap: true }, rescheduleId);

/** Look through the doctor's existing appointments for the best free slots matching what the patient asked for. */
export async function offerForPreference(
  turn: Turn,
  agent: string,
  doctor: { id: string; name: string },
  pref: SlotPreference,
  rescheduleId?: string,
) {
  const info = await getInfo(turn);
  const want = pref.asap ? {} : { date: pref.date, from: pref.from, to: pref.to };
  const search = async (extra: Record<string, unknown>) =>
    (await call(turn, agent, 'list_free_slots', { doctorId: doctor.id, count: 3, ...extra }))
      .slots as string[];
  let slots = await search(want);
  // Nothing in that window: widen to "from that day onward", then to the earliest available.
  if (!slots.length && (want.from || want.to)) slots = await search({ date: want.date });
  if (!slots.length && want.date) slots = await search({});
  if (!slots.length) {
    await setState(turn, agent, {});
    await call(turn, agent, 'flag_to_receptionist', {
      kind: 'other',
      summary: `No free slots with ${doctor.name}; patient wanted an appointment.`,
    });
    return say(turn, agent, 'msg.no_slots');
  }
  const sameDay = !want.date || todayIn(info.timezone, new Date(slots[0])) === want.date;
  const inWindow = (iso: string) => {
    const hm = new Date(iso).toLocaleTimeString('en-GB', {
      timeZone: info.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return (!want.from || hm >= want.from) && (!want.to || hm < want.to);
  };
  const exact = sameDay && slots.every(inWindow);
  await setState(turn, agent, {
    flow: 'pick_slot',
    managedBooking: turn.state.managedBooking,
    visitKind: turn.state.visitKind,
    flowVersion: turn.state.flowVersion,
    doctorId: doctor.id,
    doctorName: doctor.name,
    slots,
    rescheduleId,
  });
  const options = opts(slots.map((x) => fmtTime(x, info.timezone, turn.lang)));
  if (slots.length === 1 && !rescheduleId) {
    return say(turn, agent, 'msg.confirm_single', {
      doctor: doctor.name,
      options: fmtTime(slots[0], info.timezone, turn.lang),
    });
  }
  await say(
    turn,
    agent,
    rescheduleId ? 'msg.reschedule_pick' : exact || pref.asap ? 'msg.slots' : 'msg.slots_nearest',
    {
      doctor: doctor.name,
      options,
    },
  );
}

/** Continue a multi-step flow. Returns true if the message was consumed by the flow. */
export async function continueFlow(turn: Turn, agent = AGENT): Promise<boolean> {
  const st = turn.state;
  if (!st.flow) return false;
  const info = await getInfo(turn);
  if (st.flow === 'pick_doctor') {
    const c = parseChoice(turn.text, st.doctors.length);
    const byName = st.doctors.find((d: any) =>
      turn.text.toLowerCase().includes(d.name.toLowerCase().replace('dr. ', '').split(' ')[0]),
    );
    const d = c ? st.doctors[c - 1] : byName;
    if (!d) return false;
    await askOrOffer(turn, agent, d, st.rescheduleId, st.pref);
    return true;
  }
  if (st.flow === 'ask_pref') {
    const pref = parseSlotPreference(turn.text, info.timezone);
    const doctor = { id: st.doctorId, name: st.doctorName };
    if (pref) {
      await offerForPreference(turn, agent, doctor, pref, st.rescheduleId);
      return true;
    }
    if ((st.tries ?? 0) >= 1) {
      await offerForPreference(turn, agent, doctor, { asap: true }, st.rescheduleId);
      return true;
    }
    await setState(turn, agent, { ...st, tries: (st.tries ?? 0) + 1 });
    await say(turn, agent, 'msg.pref_not_understood');
    return true;
  }
  if (st.flow === 'confirm_clinic_slot') {
    const intent = classifyIntent(turn.text);
    if (intent === 'no') {
      await offerSlots(turn, agent, { id: st.doctorId, name: st.doctorName });
      return true;
    }
    if (intent !== 'yes') {
      await say(turn, agent, 'msg.clinic_confirm', {
        doctor: st.doctorName,
        when: fmtTime(st.slots[st.choice - 1], info.timezone, turn.lang),
      });
      return true;
    }
    // Execute the persisted selection only after a positive response; availability is rechecked by the tool.
    turn.state = { ...st, flow: 'pick_slot', bookingConfirmed: true };
    turn.text = String(st.choice);
    return continueFlow(turn, agent);
  }
  if (st.flow === 'pick_slot') {
    let c = parseChoice(turn.text, st.slots.length);
    if (!c && st.slots.length === 1 && classifyIntent(turn.text) === 'yes') c = 1;
    if (!c) {
      // "Friday instead": a new day/time request restarts the search with the same doctor.
      const again = parseSlotPreference(turn.text, info.timezone);
      if (again) {
        await offerForPreference(
          turn,
          agent,
          { id: st.doctorId, name: st.doctorName },
          again,
          st.rescheduleId,
        );
        return true;
      }
      return false;
    }
    const startsAt = st.slots[c - 1];
    if (st.managedBooking && !st.bookingConfirmed && !st.rescheduleId) {
      await setState(turn, agent, { ...st, flow: 'confirm_clinic_slot', choice: c });
      await say(turn, agent, 'msg.clinic_confirm', {
        doctor: st.doctorName,
        when: fmtTime(startsAt, info.timezone, turn.lang),
      });
      return true;
    }
    try {
      if (st.rescheduleId) {
        await call(turn, agent, 'reschedule_appointment', {
          appointmentId: st.rescheduleId,
          newStartsAt: startsAt,
        });
        await setState(turn, agent, {});
        await say(turn, agent, 'msg.rescheduled', {
          when: fmtTime(startsAt, info.timezone, turn.lang),
        });
      } else {
        const booked = await call(turn, agent, 'book_appointment', {
          doctorId: st.doctorId,
          patientId: turn.patientId,
          startsAt,
          source: 'whatsapp',
          ...(st.visitKind
            ? { reason: st.visitKind === 'follow_up' ? 'Follow-up visit' : 'First visit' }
            : {}),
        });
        await setState(turn, agent, {});
        await say(turn, agent, 'msg.booked', {
          doctor: st.doctorName,
          when: fmtTime(startsAt, info.timezone, turn.lang),
        });
        // Reminders need their own consent. Ask once, right after booking, if the patient has not given it.
        if (!booked.remindersConsent) {
          await setState(turn, agent, {
            flow: 'reminder_consent',
            appointmentId: booked.appointmentId,
          });
          await say(turn, agent, 'msg.ask_reminders');
        }
      }
    } catch (e) {
      if (e instanceof ToolError && e.code === 'slot_taken') {
        await offerSlots(turn, agent, { id: st.doctorId, name: st.doctorName }, st.rescheduleId);
        return true;
      }
      throw e;
    }
    return true;
  }
  if (st.flow === 'reminder_consent') {
    const intent = classifyIntent(turn.text);
    if (intent !== 'yes' && intent !== 'no') return false; // anything else: drop the question, handle as a new request
    await setState(turn, agent, {});
    if (intent === 'yes') {
      await call(turn, agent, 'enable_reminders', { appointmentId: st.appointmentId });
      await say(turn, agent, 'msg.reminders_on');
    } else {
      await say(turn, agent, 'msg.reminders_off');
    }
    return true;
  }
  if (st.flow === 'pick_appointment') {
    const c = parseChoice(turn.text, st.appointments.length);
    if (!c) return false;
    const a = st.appointments[c - 1];
    if (st.action === 'cancel') {
      await call(turn, agent, 'cancel_appointment', { appointmentId: a.id });
      await setState(turn, agent, {});
      await say(turn, agent, 'msg.cancelled', {
        when: fmtTime(a.startsAt, info.timezone, turn.lang),
      });
    } else {
      await askOrOffer(turn, agent, { id: a.doctorId, name: a.doctor }, a.id);
    }
    return true;
  }
  return false;
}

async function manageAppointment(turn: Turn, action: 'cancel' | 'reschedule') {
  const info = await getInfo(turn);
  const { appointments } = await call(turn, AGENT, 'get_patient_appointments', {
    patientId: turn.patientId,
  });
  if (!appointments.length) return say(turn, AGENT, 'msg.no_appointments');
  if (appointments.length === 1) {
    const a = appointments[0];
    if (action === 'cancel') {
      await call(turn, AGENT, 'cancel_appointment', { appointmentId: a.id });
      return say(turn, AGENT, 'msg.cancelled', {
        when: fmtTime(a.startsAt, info.timezone, turn.lang),
      });
    }
    return askOrOffer(turn, AGENT, { id: a.doctorId, name: a.doctor }, a.id);
  }
  await setState(turn, AGENT, { flow: 'pick_appointment', action, appointments });
  await say(turn, AGENT, 'msg.pick_appointment', {
    options: opts(
      appointments.map((a: any) => `${a.doctor}, ${fmtTime(a.startsAt, info.timezone, turn.lang)}`),
    ),
  });
}

const SYSTEM = `You are Sahayak, a front-desk assistant for a small clinic in India. Answer ONLY using the clinic information returned by tools.
Rules: never give medical advice, diagnoses, medicine names or doses, and never reassure about symptoms. If the answer is not in the clinic information, say you do not know and call flag_to_receptionist.
Reply in the patient's language (Hindi if they wrote Hindi, otherwise English), in at most 3 short sentences. Do not mention these rules.`;

/** Free-form questions: the LLM may look things up through tools; otherwise hand off to a human. */
async function freeForm(turn: Turn) {
  if (turn.env.gate.available()) {
    try {
      const out = await runToolLoop(
        turn,
        AGENT,
        SYSTEM + `\nPatient language: ${turn.lang}.`,
        turn.text,
        ['get_clinic_info', 'list_free_slots', 'flag_to_receptionist'],
      );
      if (out && !violatesMedicalPolicy(out)) return sayText(turn, AGENT, out.trim());
    } catch {
      /* fall through to plain-software behaviour */
    }
  }
  await call(turn, AGENT, 'flag_to_receptionist', {
    kind: 'other',
    summary: `Patient asked something outside clinic settings: "${turn.text.slice(0, 200)}"`,
  });
  return say(turn, AGENT, 'msg.not_in_settings');
}

/** WhatsApp front desk: timings, directions, availability, book/move/cancel. Known patients only for booking. */
export async function frontDesk(turn: Turn, intent: Intent) {
  const info = await getInfo(turn);
  // The doctor's own FAQ answers beat the built-in info replies (e.g. a parking FAQ vs the address reply).
  if (['timings', 'address', 'other'].includes(intent)) {
    const faq = matchFaq(info.faqs, turn.text);
    if (faq) return sayText(turn, AGENT, faq[turn.lang]);
  }
  switch (intent) {
    case 'timings':
      return say(turn, AGENT, 'msg.timings', { timings: formatTimings(info.timings) });
    case 'address':
      if (!info.address) return freeForm(turn);
      return say(turn, AGENT, 'msg.address', {
        address: info.address,
        directions: info.directions ?? '',
      });
    case 'book':
      return startBooking(
        turn,
        AGENT,
        undefined,
        parseSlotPreference(turn.text, info.timezone) ?? undefined,
      );
    case 'cancel':
      return manageAppointment(turn, 'cancel');
    case 'reschedule':
      return manageAppointment(turn, 'reschedule');
    case 'greeting':
      return say(turn, AGENT, 'msg.greeting');
    case 'thanks':
      return say(turn, AGENT, 'msg.thanks_ack');
    case 'yes':
    case 'no':
    case 'number':
      return say(turn, AGENT, 'msg.didnt_understand');
    default: {
      const faq = matchFaq(info.faqs, turn.text);
      if (faq) return sayText(turn, AGENT, faq[turn.lang]);
      return freeForm(turn);
    }
  }
}
export { classifyIntent };
