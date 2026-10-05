# Standard clinic appointment conversation (v1)

Sahayak owns the conversation; clinics do not author agent prompts or booking workflows.

Hi → menu → Book appointment (or Yes) → First visit / Follow-up → name and visit-data consent if unknown → doctor (skip for a dedicated number/single doctor) → preferred day/time → real available slots → explicit Yes confirmation → appointment saved → separate optional reminder consent.

Current choices are numbered text replies, compatible with WhatsApp and the local simulator. Native WhatsApp interactive buttons and live calling transport are not implemented by this change.

## Storage and responsibility

- Flow code/version: packages/agents/src/agents/clinic-menu.ts, frontdesk.ts and leads.ts; product-owned, reviewed in version control.
- English/Hindi messages: packages/shared/src/i18n.
- Clinic information: existing clinic_settings and doctors schedules, slot lengths, holidays/availability. Clinics maintain factual settings, not flow logic.
- Progress: clinic-scoped conversations.state, including flowVersion, visitKind, selected doctor/slots and pending confirmation. Never rely on the browser tab or LLM memory.
- Bookings: existing appointments table via book_appointment. First/follow-up is recorded in reason; it does not infer eligibility, discounts or treatment.
- Consent, conversation history and audit: existing Sahayak tables and tools.

The AI Agent Platform should provide clinic-bound WhatsApp transport and credentials. Sahayak remains the authority for patient consent, safety, scheduling and appointments. Do not run an independent generic FAQ responder against clinic messages or copy schedules into prompts as availability.

Safety/privacy/human handoff precede the menu. Slots are rechecked under the existing booking lock at confirmation; stale selections offer fresh availability. Reminders require their own consent. The same orchestrator can serve voice text, but a live calling provider and channel wiring still need integration.

## Test

Use the existing clinic simulator with Hi, 1, 1 (or 2 for follow-up), then follow the prompts. Check the appointment appears in the clinic app only after YES. Real WhatsApp requires deployment and configuration of the implemented platform-to-Sahayak bridge and an owner-authorized number before an end-to-end live test.
