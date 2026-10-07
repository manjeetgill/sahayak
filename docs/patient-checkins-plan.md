# Patient check-ins and feedback

## Purpose
Help patients reconnect after a visit, assign concerns to staff, and turn private feedback into clinic improvements. Recovery feedback and clinic-experience feedback are separate. Silence is never interpreted as satisfaction or as the patient leaving the clinic.

## Implemented phases

| Phase | What is implemented | Verification / boundary |
| --- | --- | --- |
| 1. Schedule | Visit completion controls, future date, responsible staff, language, explicit agreement and optional single reminder | Existing messaging and follow-up consent is required; duplicate active schedules are rejected |
| 2. Patient response | English/Hindi mobile form, recovery choices, help topic, optional clinic topic and free text | 256-bit private tokens, hash-only storage, 7-day expiry, no patient identity/history in public responses; source response stored once |
| 3. Staff ownership | Doctor Inbox integration, patient history, receptionist work list, filters, assignment, due dates, contact notes and ordered actions | Doctor review is required for clinical concerns, even when the patient selected callback |
| 4. AI assistance | Staff-triggered model classification with exact source excerpts, uncertainty and a safe acknowledgement draft | Original text remains visible; invented excerpts fail validation; unavailable AI falls back to staff review. No model-driven treatment or automated clinical reply |
| 5. Messaging | Reviewed platform template invitations, per-clinic pause/enable, minute-based scheduler, consent and quiet-hour checks, idempotent preparation/approval, status refresh and one optional reminder | Live sending remains gated by provider template support and a public HTTPS patient form. See external dependencies below |
| 6. Resolution | Patient confirmation after recorded clinic action; “partly” / “still need help” reopens the concern | Replays are idempotent. Preparing a link or receiving silence does not close work |
| 7. Improvement | Last-30-day response/contact counts, contact turnaround, source-linked service themes, resolution results, assigned improvement tasks | Themes are based on patient-selected topics, not inferred retention or treatment effectiveness |
| 8. Demo and verification | Separate synthetic demo clinic, integration tests and browser walkthrough | A real clinic pilot with opted-in participants has not been conducted |

## Screens
- Doctor: **Care → Patient check-ins** (`/doctor/checkins`). Tabs: Patient responses, Clinic improvements, WhatsApp messages.
- Receptionist: **Patient check-ins** (`/console/checkins`). Can assign and record contact; clinical action/closure requires a doctor.
- Patient record: check-in history and source responses.
- Visit completion: schedule the check-in, record agreement and choose a responsible staff member.
- Patient form: `/c/:slug/feedback#<private-token>`. Tokens stay in the URL fragment rather than query strings, and travel to the API only in POST bodies. Pages have no-referrer/noindex metadata and API responses are no-store.

## Live messaging dependencies — explicit limits
The deployed AI-Agent-Platform was inspected read-only; its code was not modified.

Its outbound pilot supports approved text-only templates without substitution parameters or buttons. The Chakra adapter currently refuses outbound template catalogue access. Sahayak therefore cannot claim to have sent a live check-in through that connection.

The supported flow is:
1. Clinic reviews a provider-approved static invitation asking the patient to reply **FEEDBACK**.
2. The clinic enables scheduled invitations explicitly.
3. The scheduler uses the platform draft + approval API, with one stable key per check-in and message kind.
4. After the patient replies FEEDBACK, the normal safety/privacy pipeline creates a private response link for that patient's pending check-in.
5. The patient submits the form; staff handle the concern in Sahayak.

Set `CHECKIN_PUBLIC_WEB_URL` to the deployed web app's HTTPS origin before using links on real phones. The browser demo works on localhost without this. A public frontend must also have a working HTTPS API configuration; Sahayak does not expose the Mac automatically.

New invitations require current consent and 08:00–20:59 clinic local time. One reminder is eligible two days after **confirmed delivery**, only when specifically opted in and no response has arrived. Provider acceptance/queueing is not labelled delivery. A changed template is blocked until reviewed again. Failures before platform preparation can be checked again safely; uncertain preparation/approval is held for reconciliation rather than blindly retried. Pausing or opting out prevents new dispatches; the platform has no cancellation API for a message already handed off, which may still arrive.

Currently, callback and resolution links can be prepared for clinic staff to share. Automated free-form clinical replies, automated calls and automatic resolution-message delivery are not part of this implementation.

## Consent and data
Check-in agreement wording v1: “The patient agreed to this check-in and knows they can opt out through the clinic or by replying STOP.”

STOP and the public form opt-out revoke messaging/follow-up consent and expire form links. Unresolved patient concerns remain visible for care; stopping outreach does not erase or close them. Patient export includes responses/history/resolutions. Erasure cascades through links, responses and history, and redacts linked improvement titles. Audit logs exclude private tokens and response/note bodies.

## Verification
- Final targeted suite: **29 passed, 1 existing skip** across feedback lifecycle, patient check-ins, existing care workflows, Doctor Inbox and WhatsApp bridge. Type checking and lint on the added feature files passed.
- Tests cover tenant isolation, permissions, explicit consent, dates, duplicate scheduling/submission, expired links, red flags, ordered review, unresolved reopening, repeated confirmations, mocked platform sending/delivery, source validation and erasure.
- Mobile form checked at 390px: no horizontal overflow.
- Browser walkthrough: schedule from visit completion; Hindi form with Hinglish response; doctor response/history; live-model source excerpts using synthetic text; contact → clinic action → resolution link; unresolved confirmation reopening; improvement task with original-source navigation; receptionist list.
- Model output is assistive and requires staff review. Synthetic tests do not establish clinical performance.

## Demo
See [patient-feedback-demo.md](patient-feedback-demo.md) for a short meeting walkthrough.

## Automatic scheduling when a visit finishes (implemented)

- Doctor → Patient check-ins → Automatic check-ins holds persistent preferences for that doctor: on/off, same day or 1–30 days later, time in the clinic’s timezone, responsible doctor/receptionist, and one optional reminder.
- `Finish visit` saves the completed visit and its check-in in one transaction. The existing “Next patient” completion path also uses the same scheduling helper.
- Existing WhatsApp and follow-up permissions are required. The check-in records their existing consent timestamp and an explicit automatic-scheduling notice identifier; it does not invent new per-visit patient consent.
- Uses the patient’s saved language. If the same-day time has passed, uses that time the following day. Send times are constrained to 08:00–20:59 clinic time.
- Keeps a manually scheduled check-in; never duplicates one or recreates a cancelled one. Missing permission does not prevent completing the consultation.
- Settings changes apply to future visit completions, not past visits or already scheduled check-ins. Scheduling starts only after the doctor enables and saves the preference.
- Admin delivery settings remain independent: verified WhatsApp connection, approved invitation template, public HTTPS form address and delivery enabled. Check-ins can be scheduled while delivery is paused; no live messages are sent by finishing a visit itself.
- The finish checklist previews the schedule or explains why no automatic check-in will be created. Manual scheduling remains an optional exception.
