# Clinic care workflows

These workflows run inside Sahayak. AI-Agent-Platform is not required or modified.

## Pre-visit brief and dictation

The doctor opens a patient record to see dated booking concerns, intake answers,
recent visits, signed-note excerpts, and uploaded-file metadata. Links lead to the
source notes, visits, intake answers, or the audited file download. This is an
attributed record overview, not a diagnosis or interpretation of uploaded files.

Dictation uses the existing browser speech recognition. The note composer shows
the original transcript alongside editable sections. Notes created during a called
or active visit for that doctor are linked to the visit. Missing sections stay
empty; signing remains an explicit doctor action. AI structuring is opt-in through
the existing clinic scribe setting. Source validation compares complete segments,
including numbers and negation, and falls back to deterministic headings when the
model changes or omits content. Prescription generation is not added.

## Reports and referrals

Doctors can create patient tasks for reports, referrals, documents, follow-up, and
instruction review. Each task has a responsible doctor and due date. The clinic
overview is `/doctor/care`; patient-specific controls are in the patient record.
Clinical task text is doctor-only and excluded from tool audit payloads.

Transitions are requested → received/prepared → reviewed → informed. Reports need
a file from the same patient before the received transition. Review records the
doctor and time. Informed records that a human completed patient communication;
it does not send a message. Closed tasks cannot be silently edited. Overdue tasks
remain visible. Only explicitly entered requirements can be tracked.

## Cancellation waiting list

Staff use `/doctor/waitlist` to record patient opt-in, doctor, and date range.
Existing messaging and reminder consent are required. Cancelling a future booked
appointment attempts an offer to an eligible waiting patient in signup order,
during 08:00–21:00 clinic time. A patient has at most one pending offer per waiting
entry. Staff can use Offer next after an offer expires; there is no automatic
repeated outreach or background offer rotation.

Offers hold the slot for 15 minutes. Patients reply `ACCEPT <code>` from their
registered WhatsApp contact. Safety, privacy and human ownership checks run first;
a paused front desk hands acceptance to staff. Acceptance checks patient identity,
consent, expiry, and current waitlist state, then books atomically. Per-doctor
transaction locks, reservation-aware availability, and the existing unique active
appointment index prevent competing bookings of the same start time.

Queued offer messages carry an offer reference. The sender skips expired,
withdrawn, already-accepted, out-of-hours, or consent-withdrawn offers. Provider
delivery still requires a configured messaging adapter and provider approval;
the mock adapter stores the message for simulation. Existing appointments are not
automatically cancelled when a patient accepts a new offer.

## Finishing visits

The doctor's Finish action now opens a checklist: signed/unsigned visit notes,
draft issued documents, the next booked appointment, and outstanding tasks
(including older tasks). The doctor acknowledges the review before finishing.
This is a UI review step, not a requirement to finish every future task that day.
Existing API clients retain the existing finish endpoint.

## Data and verification

Migration `014_care_workflows.sql` adds tenant-isolated task, waitlist, and offer
tables and the outbound offer reference. Patient exports include these records;
erasure removes operational tasks and waiting-list records. Clinical content is
not copied into audit input/output. Source views and task changes use audited tools.

Tests cover source fidelity, changed doses/negation, correct visit/document
ownership, ordered review, tenant separation, consent, expiration, and concurrent
offer acceptance. Real microphone accuracy and provider delivery require live
clinic testing with consented test participants.
