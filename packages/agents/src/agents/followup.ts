import { normalise } from '@sahayak/shared';
import { call, say, setState, type Turn } from '../turn';

const AGENT = 'followup';
const WORSE = [
  /\b(worse|worsen|worsening|not better|no better|getting bad|increased|more pain|pain (is )?increasing|fever (is )?(back|higher|increasing)|still (have )?(pain|fever))\b/,
  /\b(aur kharab|zyada ho|badh (gaya|gayi|raha|rahi)|tabiyat (bigad|kharab)|abhi bhi (dard|bukhar))\b/,
  /और खराब|बिगड़|बढ़ गया|बढ़ गई|अभी भी (दर्द|बुखार)|तबीयत खराब|आराम नहीं/,
];

/** Reply to a post-visit check-in. Worsening symptoms always reach the doctor's team as an urgent item. */
export async function continueFollowup(turn: Turn): Promise<boolean> {
  if (turn.state.flow !== 'followup_checkin') return false;
  const worse = WORSE.some((r) => r.test(normalise(turn.text)));
  await call(turn, AGENT, 'flag_to_receptionist', {
    kind: worse ? 'medical_question' : 'other',
    severity: worse ? 'urgent' : 'normal',
    summary: `${worse ? 'Patient reports NOT improving / worsening' : 'Post-visit reply'}: "${turn.text.slice(0, 250)}"`,
  });
  await setState(turn, AGENT, {});
  await say(turn, AGENT, worse ? 'msg.followup_worse' : 'msg.followup_ack');
  return true;
}

/**
 * Private rating after a visit. Everyone who rates is offered the public review link (asking only happy patients
 * would be "review gating", which review sites forbid). Low ratings also alert the receptionist to reach out.
 */
export async function continueReview(turn: Turn): Promise<boolean> {
  const st = turn.state;
  if (st.flow === 'review_comment') {
    await call(turn, AGENT, 'add_feedback_comment', { comment: turn.text.slice(0, 500) });
    await setState(turn, AGENT, {});
    await say(turn, AGENT, 'msg.review_comment_thanks');
    return true;
  }
  if (st.flow !== 'review_rating') return false;
  const num = turn.text.trim().match(/^([1-5])(?:\s*(?:\/\s*5|stars?))?\s*[.!]?$/i);
  const stars = /^[\s⭐]+$/.test(turn.text) ? (turn.text.match(/⭐/g) ?? []).length : 0;
  const rating = num ? Number(num[1]) : stars >= 1 && stars <= 5 ? stars : 0;
  if (!rating) return false;
  await call(turn, AGENT, 'record_feedback', {
    rating,
    queueEntryId: st.queueEntryId,
    doctorId: st.doctorId,
  });
  const info = await call(turn, AGENT, 'get_clinic_info', {});
  if (rating <= 3) {
    await setState(turn, AGENT, { flow: 'review_comment' });
    await say(turn, AGENT, 'msg.review_sorry');
  } else {
    await setState(turn, AGENT, {});
    await say(turn, AGENT, 'msg.review_thanks');
  }
  if (info.reviewUrl) await say(turn, AGENT, 'msg.review_link', { link: info.reviewUrl });
  return true;
}
