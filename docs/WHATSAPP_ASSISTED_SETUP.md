# Assisted clinic WhatsApp setup

Open Agents → WhatsApp in Sahayak. A doctor saves the clinic business number (international format) ; doctor timings and appointment rules come from existing Sahayak settings. These are clinic-isolated and audited with redacted content. Receptionists can view status, not change connections.

The operator provisions a separate business workspace on the AI Agent Platform and supplies its business-scoped credential on the Sahayak backend. Do not reuse the pilot credential across clinics.

Backend environment (separate from custom-agent drafting):
- AGENT_CHANNEL_PLATFORM_URL: private HTTPS API origin, or loopback API behind a secure tunnel. The public webhook hostname need not expose /v1.
- AGENT_CHANNEL_CREDENTIALS: JSON mapping clinic UUIDs to objects with key and externalUserId. Keep this in server secrets, never NEXT_PUBLIC variables. Use the business credential API’s returned external user identity.

Apply migration 018 with the normal database migration command. Restart API/web after deployment. Missing/invalid channel configuration does not prevent the app starting; setup details can still be saved.

The platform operator must configure Chakra partner onboarding. Once available, the doctor clicks Authorize WhatsApp; the owner completes the provider login, permission and OTP prompts. Only a short-lived signup token goes to the browser. The callback records a candidate plugin, not proof of ownership. The operator independently verifies the clinic/number/plugin mapping and binds the saved session using the platform’s documented operator command. Check connection status in Sahayak afterwards.

Interrupted STARTING or CHECK_REQUIRED requests require operator reconciliation. Do not blindly create another provider connection. Persisted sessions can be checked after closing the tab, but the short-lived authorization widget itself is not resumed automatically.

## Remaining before live clinic activation

This change supplies intake, embedded authorization and connection status. It does not claim patient messaging is active. The operator must still configure its channel and webhook, and deploy/configure the signed platform bridge for the standard clinic booking flow through Sahayak’s consent, red-flag, human-handover and audit pipeline. The generic platform FAQ responder must not bypass these clinic checks. The UI explicitly keeps live replies paused. Calling-agent setup is separate.

Validate with one authorized owner and a second test number before opening patient traffic. No live external messages are sent by these setup routes.

The clinic does not design a chatbot or need to provide FAQs for booking. See CLINIC_APPOINTMENT_FLOW.md for the product-owned conversation and storage responsibilities.

The signed bridge is implemented in apps/api/src/whatsapp-bridge.ts. See the AI Agent Platform repository’s docs/SAHAYAK_WHATSAPP_BRIDGE.md for both environment mappings, channel mode, deployment and activation checks. Live activation remains an operator step after a real-number test.

### Attach an existing verified pilot

An operator can attach an existing authorized channel without fabricating an
Embedded Signup session. Configure the clinic-scoped backend credential and the
matching `AGENT_CHANNEL_BRIDGE_BINDINGS` entry privately, then run from this repo:

```sh
pnpm --filter @sahayak/api exec tsx src/attach-whatsapp-pilot.ts CLINIC_UUID CHANNEL_UUID +COUNTRYCODE_NUMBER
```

The command verifies the saved app/channel association against the platform and
uses the audited system-only tool. It refuses to overwrite a different connection.
The setup screen reads the real channel status, supports pause/enable, and shows
service unavailability without claiming cached ACTIVE status is live. The local
pilot uses an SSH forward on 4065 for the private platform API and an SSH reverse
forward for the clinic callback; the laptop and both connections must stay running.

### Patient choices

The WhatsApp clinic flow now supplies native menus for greeting, first/follow-up
visit, doctor, earliest/tomorrow preference, available slot, booking confirmation,
and reminder consent. Names and custom requests remain typed. English and Hindi
labels live in the shared dictionaries. Every choice ID is tied to the current
conversation state; stale taps repeat current options without making a booking.
Existing typed replies remain supported. Lists longer than ten choices retain
the full numbered text fallback.

### Recover the existing pilot connection

The approved pilot server is `deploy@139.59.64.197`, using the existing
`~/.ssh/id_ed25519_nralgo` identity. With Sahayak's API running on port 4000,
restore the same connection using:

```sh
sh scripts/whatsapp-tunnel.sh
```

Leave that terminal running. The local forward maps loopback 4065 to the platform's
loopback 4060; the reverse forward maps the server's loopback 44000 to Sahayak's
local 4000. The command fails if either forward cannot be bound, rather than
silently leaving a partial connection. Do not run a second copy while it is active.

On 6 October 2026 the connection was restored and the platform reported ACTIVE
with live replies enabled. The remote callback health check returned `ok: true`.
These checks confirm connectivity, not delivery of a new WhatsApp message.
A fresh message from the owner's phone is still required to confirm delivery.
This local pilot stops working when the Mac sleeps, loses networking, or the
API/tunnel stops; it is not an always-on deployment.

### Lower-latency pilot worker (6 October 2026)

The operational scheduler in `scripts/whatsapp-fast-worker.py` uses the deployed
platform's existing `heartbeat`, `tick_outbound` and `tick` handlers. Idle polling
is 250 ms instead of 2 seconds; health writes occur every 10 seconds; failures
retain a 2-second backoff. Safety, conversation locks, ordering, dispatch fences
and uncertain-delivery handling remain in the installed handlers.

Tests: `python3 scripts/test_whatsapp_fast_worker.py`.

The server override is `deploy/compose.sahayak-fast.json` in
`/opt/agent-platform/pilot`. It pins the previously running worker image and mounts
`deploy/sahayak-fast-worker.py` read-only. Preserve all existing Compose files and
explicitly use project name `-p agent-platform`. Include the fast override last.
To roll back, recreate only `whatsapp-worker` with the original three Compose
files, omitting this override. Do not rebuild unrelated services. Before changing
the pinned image in a future deployment, verify the scheduler imports against the
new platform worker. This is a pilot deployment adjustment, not a platform-source
change; it must be considered in future platform releases.

Baseline fresh-message timestamps showed about 8–11 seconds from the provider's
inbound timestamp to delivery confirmation. The poll change removes up to 1.75
seconds of idle pickup delay; provider transport and model latency remain. A fresh
owner message is required to measure end-to-end improvement.

### Persistent Mac services

Run `python3 scripts/install-local-services.py` from an authorized local terminal
to install the user login services `in.sahayak.local.api`,
`in.sahayak.local.web` and `in.sahayak.local.whatsapp-tunnel`.
They start at login and restart after process exit, with a 10-second throttle.
The tunnel runs SSH directly from the home directory, avoiding macOS Desktop
access restrictions on background shell scripts. Logs are in
`~/Library/Logs/Sahayak` (owner-only directory). PostgreSQL and Redis still need
to be running in Docker; this does not make a sleeping/offline Mac available.
Use `SAHAYAK_SERVICE=whatsapp-tunnel` to reinstall only that service.
Stop a service using `launchctl bootout gui/$(id -u)/in.sahayak.local.SERVICE`.
Do not also run a duplicate API, web server or tunnel manually on the same ports.

### WhatsApp outbound calling readiness — 6 October 2026

Enabled the existing voice runtime using the worker-only server override
`deploy/compose.sahayak-calling.json` (existing voice-worker image pinned,
`AI_WHATSAPP_CALLING_ENABLED=1`). Include it after the existing Compose overrides
with `-p agent-platform`. Audio imports/credentials pass, `media_ready=true`, and
the signed Sahayak calling-handler probe passes. These are readiness checks, not
a completed live audio test.

Provider activation remains blocked. The authorized calling-settings POST returned
HTTP 400 / Meta error 138015: “Calling APIs cannot be enabled for this phone
number.” Subsequent settings showed `calling.status=NOT_SET`. The clinic calling
agent remains disabled; no call was placed or permission request sent. Chakra/Meta
must resolve number eligibility for +917703961610 before recipient permission,
agent activation, live-call testing and the WhatsApp “Call me” action can be
completed. Do not bypass readiness or represent the browser-voice link as dialing.
