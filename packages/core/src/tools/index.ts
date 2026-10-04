import { registerTools } from './registry';
import { checkinTools } from './checkin';
import { queueTools } from './queue';
import { appointmentTools } from './appointments';
import { deskTools } from './desk';
import { scheduleTools } from './schedule';
import { followupTools } from './followups';
import { builderTools } from './builder';

let done = false;
/** Register every tool module once. Called by the API/agent runtime at startup. */
export function registerAllTools() {
  if (done) return;
  registerTools([
    ...checkinTools,
    ...queueTools,
    ...appointmentTools,
    ...deskTools,
    ...scheduleTools,
    ...followupTools,
    ...builderTools,
  ]);
  done = true;
}
export * from './registry';
export * from './common';
export { planFollowups } from './followups';
export { freeSlots, nextFreeSlots } from './appointments';
