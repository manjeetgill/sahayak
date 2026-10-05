# Inbound calling through AI-Agent-Platform

The platform owns the voice provider and signed public callbacks. Sahayak owns
clinic schedules, consent, available slots and appointment confirmation.

## Pilot status — 5 October 2026

- Intended clinic number: +91 77039 61610. Saved as a request, **not voice-authorized**.
- Calling API and migration 022 deployed on the existing DigitalOcean server.
- Clinic calling draft: 418c8845-97b3-4346-983b-1acc1a2c4731, inactive.
- Signed HTTPS readiness probe through
  `https://shayak.myalgodesk.in/integrations/agent-platform/calling` passed.
- Sahayak still runs locally; the pilot uses the existing private SSH relay.
  The laptop and tunnel must stay on. This is not a permanent clinic deployment.
- Appointment booking, duplicate fencing, isolated call sessions, emergency
  escalation and the actual Python/TypeScript HTTP contract passed automated tests.
- No real telephone call, speech recognition or voice-number routing has been verified.
- Ordinary phone calls use the implemented Twilio adapter. WhatsApp calls require
  a separate media/call adapter; the existing WhatsApp messaging connection alone
  does not establish either voice path.

## Operator binding

Set `AGENT_CALLING_BRIDGE_BINDINGS` in the private Sahayak environment. It is a
JSON object keyed by platform calling-agent UUID:

```json
{
  "PLATFORM_AGENT_UUID": {
    "clinicId": "CLINIC_UUID",
    "appId": "PLATFORM_APP_UUID",
    "secret": "PRIVATE_RANDOM_SECRET_AT_LEAST_32_CHARACTERS",
    "requestedNumber": "+COUNTRYCODE_NUMBER"
  }
}
```

The matching platform `handler_url` points to the calling endpoint above and
`handler_secret` must match `secret`. Never expose either app credentials or this
secret to the patient browser. Apply migration 024 before enabling the handler.
Existing `AGENT_CHANNEL_PLATFORM_URL` and per-clinic `AGENT_CHANNEL_CREDENTIALS`
are reused only for backend readiness reads (three-second timeout). Missing
calling configuration does not stop the main clinic app.

The clinic assistants screen displays the requested number and distinguishes
pending authorization, paused, enabled-needs-test, and service unavailable.
A saved number is never treated as a working voice connection.

## Booking and isolation

Every call has a new conversation scoped to its platform agent and call UUID.
Caller ID cannot unlock staff tools, previous conversations or patient records.
The caller may hear public clinic information or make a new booking (including
selecting first visit/follow-up). Name and visit-data consent come first, then
real availability and an explicit YES for the selected appointment. Existing
patient information is not read back; cancellations, private records, account
changes and medical questions go to reception. Human handoff creates a flag,
speaks the relevant message and ends the call; it does not transfer the call.

English/Hindi menu choices work as digits or short spoken numbers. Speech input
is untrusted data. Each event is HMAC authenticated, timestamp bounded, checked
against app/agent binding, and durably claimed before business work. Duplicate
events return cached replies; changed content, skipped turns and uncertain/crashed
turns cannot replay the booking. Calls never send a WhatsApp message automatically.
Shared receipt erasure and retention also cover calling replies. Call session
metadata contains a keyed caller hash and references, not a raw phone number.

Outbound calling, recordings and live transfers remain later phases.

## Verification

```sh
AI_AGENT_PLATFORM_DIR=/path/to/AI-Agent-Platform pnpm exec vitest run \
  apps/api/test/calling-bridge.test.ts apps/api/test/calling-status.test.ts \
  apps/api/test/whatsapp-bridge.test.ts
pnpm typecheck
pnpm eval
```

The real-phone gate needs an authorized voice provider, routing of the intended
number, saved signed provider webhook URLs, successful activation, and one
inbound call from another phone that creates exactly one confirmed appointment.
Do not mark this gate passed from a synthetic HTTP callback or a readiness probe.

## Connection controls

The Phone calls tab now has a working **Check voice connection** button, doctor-only
**Enable incoming calling** / **Pause incoming calling**, and paginated **Phone activity**.
Enabling requires acknowledgement of provider call charges. The backend binds every
operation to the signed-in clinic and its saved agent; it never accepts another
agent ID from the browser. Status errors do not block other clinic features and
activation requests are never automatically retried.

The platform preflight reads Twilio's real incoming-number resource and verifies
account ownership, voice capability and the exact inbound/status webhook URLs and
POST methods. A verified caller ID alone does not pass. Configured SIP trunks or
TwiML applications using a different route do not pass this direct-number adapter.
The app's signed readiness probe runs only after those checks pass.

The pilot still needs a voice-provider account login, incoming-number routing and
a real call. No account was created, provider terms accepted, or number purchased.
