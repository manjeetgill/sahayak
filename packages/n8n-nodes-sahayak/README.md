# n8n-nodes-sahayak

n8n nodes for [Sahayak](../../README.md), the AI front desk for clinics.

- **Sahayak** node: list doctors, find free slots (with a time window), book / move / cancel appointments, read today's queue, send a WhatsApp message (only to patients who agreed to messages).
- **Sahayak Trigger** node: starts a flow on `patient.checked_in`, `queue.called`, `visit.finished`, `appointment.booked/cancelled/rescheduled`, `flag.raised` (emergency alerts), `schedule.shifted`, `message.received`, `patient.erased`. It registers its own webhook in Sahayak when the workflow is activated and rejects any call that is not signed by your Sahayak server.

## Set up

1. In Sahayak, sign in as the doctor, open **Integrations** and create an API key (`write`, or `admin` if you use the Trigger node).
2. In n8n, install the community node `n8n-nodes-sahayak` (Settings, Community nodes) and create a **Sahayak API** credential with your server URL and the key.
3. Webhook URLs must be public https addresses, so a self-hosted n8n needs a public URL.

## Good to know

- "Ids only" is the default for events. Choose "Include patient name and phone" only for workflows you are allowed to share patient details with.
- Erasing a patient in Sahayak sends `patient.erased` with their id: connect it to a flow that deletes the patient from your other tools.
- Limits: 120 API requests per minute per key. Failed event deliveries are retried for several hours, then a note appears on the receptionist console.

## Develop

`pnpm --filter n8n-nodes-sahayak build` compiles to `dist/`. The node classes are exercised against the real API in `apps/api/test/n8n-node.test.ts`, using a stand-in for the n8n runtime. They have **not** been run inside a live n8n instance yet: try them there before publishing.
