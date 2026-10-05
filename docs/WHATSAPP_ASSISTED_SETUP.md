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
