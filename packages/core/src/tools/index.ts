import { extractReport, searchRecord } from './record-search';
import { localWorkflowTools } from './local-workflows';
import { whatsappSetupTools } from './whatsapp-setup';
import { searchMedicalReferences } from './reference-search';
import { workbenchTools } from './clinical-workbench';
import { inboxTools } from './inbox';
import { registerTools } from './registry';
import { checkinTools } from './checkin';
import { queueTools } from './queue';
import { appointmentTools } from './appointments';
import { deskTools } from './desk';
import { scheduleTools } from './schedule';
import { followupTools } from './followups';
import { builderTools } from './builder';
import { privacyTools } from './privacy';
import { integrationTools } from './integrations';
import { setupTools } from './setup';
import { askTools } from './ask';
import { recordTools } from './records';
import { issuedTools } from './issued';
import { careTools } from './care';
import { waitlistTools } from './waitlist';
import { customAgentTools } from './custom_agents';

let done = false;
/** Register every tool module once. Called by the API/agent runtime at startup. */
export function registerAllTools() {
  if (done) return;
  registerTools([
    ...whatsappSetupTools,
    ...checkinTools,
    ...queueTools,
    ...appointmentTools,
    ...deskTools,
    ...scheduleTools,
    ...followupTools,
    ...builderTools,
    ...privacyTools,
    ...integrationTools,
    ...setupTools,
    ...askTools,
    ...recordTools,
    ...issuedTools,
    ...customAgentTools,
    ...careTools,
    ...inboxTools,
    ...workbenchTools,
    ...localWorkflowTools,
    extractReport, searchRecord,
    searchMedicalReferences,
    ...waitlistTools,
  ]);
  done = true;
}
export * from './registry';
export * from './common';
export { planFollowups } from './followups';
export { freeSlots, nextFreeSlots } from './appointments';
export { hashKey } from './integrations';
export { parseClinicQuestion, parseRange, formatMetric, METRICS } from './ask';
export { sniffMime, NOTE_FIELDS, type NoteContent } from './records';
export * from '../custom-agents';
