import { normalise } from '@sahayak/shared';
import { call, say, setState, type Turn } from '../turn';

const AGENT = 'followup';
const WORSE = [/\b(worse|worsen|worsening|not better|no better|getting bad|increased|more pain|pain (is )?increasing|fever (is )?(back|higher|increasing)|still (have )?(pain|fever))\b/,
  /\b(aur kharab|zyada ho|badh (gaya|gayi|raha|rahi)|tabiyat (bigad|kharab)|abhi bhi (dard|bukhar))\b/, /और खराब|बिगड़|बढ़ गया|बढ़ गई|अभी भी (दर्द|बुखार)|तबीयत खराब|आराम नहीं/];

/** Reply to a post-visit check-in. Worsening symptoms always reach the doctor's team as an urgent item. */
export async function continueFollowup(turn: Turn): Promise<boolean> {
  if (turn.state.flow !== 'followup_checkin') return false;
  const worse = WORSE.some((r) => r.test(normalise(turn.text)));
  await call(turn, AGENT, 'flag_to_receptionist', {
    kind: worse ? 'medical_question' : 'other', severity: worse ? 'urgent' : 'normal',
    summary: `${worse ? 'Patient reports NOT improving / worsening' : 'Post-visit reply'}: "${turn.text.slice(0, 250)}"` });
  await setState(turn, AGENT, {});
  await say(turn, AGENT, worse ? 'msg.followup_worse' : 'msg.followup_ack');
  return true;
}
