# Sahayak product roadmap

> **Coverage audit — 5 October 2026:** The full roadmap is **not complete**. Local foundations exist across six phases; several local features still need development as well as the separate live-channel dependencies. The phase descriptions below are the target scope, not a list of completed capabilities. See [feature-by-feature audit](#feature-by-feature-audit--5-october-2026).

## Goal
Help doctors finish consultations and follow through on patient care without checking many screens. Survey notes are product hypotheses to validate with a clinic pilot, not verified evidence of demand.

## Planned doctor navigation
Today; Needs my attention; Patients; Follow-up care; Medical reference; Clinic overview; Settings. Use plain English. Assistants and technical integration remain behind the scenes.

## Ownership
Sahayak owns clinic identity, patient records, consent, clinical permissions, approved care plans, signing, inbox state and audit history. AI-Agent-Platform owns assistant building/execution and live communication connections. Platform actions must use authenticated, clinic-scoped Sahayak tools with explicit approvals, duplicate-request protection and reported failures. No platform files are changed by this roadmap implementation.

## Phase 1 — Doctor Inbox and daily priorities (local workflow implemented)
Survey features: Doctor Inbox, Ping the Doctor, Doctor’s Daily Brief.

### Increment 1: source-linked review inbox — implemented
- Combine open alerts, conversations needing staff help, unreviewed reports, incomplete care tasks, unsigned visit notes and draft certificates/prescriptions.
- Put recorded urgent alerts first, then overdue tasks, then work ready for review.
- Group repeated alerts for one conversation; avoid showing a separate conversation card for the same alert.
- Link each item to its source; show patient, reason, responsible person when recorded, and time.
- Add daily attention counts to the doctor dashboard.
- Allow doctors to read the conversation behind an alert with clinic isolation and redacted auditing.
- Source records remain authoritative: signing a note or reviewing a document removes its inbox item on refresh.
- Explicitly describe clinic-wide items versus the signed-in doctor’s drafts. Do not infer unread messages or abnormal results from missing data.

### Increment 2: ownership and follow-through — local controls implemented
- Durable assignment and acknowledgement for inbox items that lack them.
- Remind me later, with expiry; never hide unacknowledged urgent alerts.
- Mark handled with recorded actor/reason and source-specific rules; viewing alone does not resolve clinical work.
- Event-driven updates and periodic refresh. Urgent items stay visible, with a 15-minute acknowledgement warning. Push, SMS and telephone escalation depend on a connected delivery service.
- Assigned-to-me view, 50-item UI pages and counts are implemented. Database-level pagination and large-clinic load testing remain outstanding.

### Acceptance
A doctor can see outstanding work and its source from one screen. Cross-clinic access and receptionist access to clinical inbox are denied. No clinical text enters audit output. Resolved source items disappear. Urgent alerts cannot be suppressed by ordinary filtering without an always-visible urgent count.

## Phase 2 — Consultation notes and approved instructions
Survey: Clinical Scribe and Patient Instructions.
Extend existing source-preserving notes with doctor-stated assessment/differential, investigation requests, follow-up and instructions. Missing findings remain blank. Prescription drafts may only reflect explicit doctor instructions, never invented medicines or doses. Doctor edits and signs. Generate instruction drafts from the signed plan. English/Hindi headings are supported now; source text is preserved, and body translation remains a doctor-reviewed task. Ambient recording is a separate consent/transcription project.
Acceptance: a reviewed consultation creates a signed note, approved instructions and confirmed tasks; no unapproved clinical content is sent.

## Phase 3 — Patient history and report understanding
Survey: Patient-specific Brief, Medical Timeline, Lab/Report Intelligence.
Add structured medicines, allergies, doctor-recorded diagnoses, investigation orders/results (unit, date and laboratory reference interval) and referral outcomes. Extract written reports with side-by-side source review, confidence and confirmation of uncertain fields. Add trends, dated history and source-grounded questions. Do not treat missing data as normal or compare incompatible units. Radiology-report extraction does not include independent interpretation of images or ECG waveforms.
Acceptance: every result/summary statement links to its original record, and uncertain values cannot silently become verified facts.

## Phase 4 — Follow-up care and live patient communication
Survey: Follow-up Agent, WhatsApp, expanded escalation.
Doctor approves a schedule or clinic template: send approved instructions, check requested tasks, collect replies, escalate to staff. Include consent, quiet hours, delivery failures, retries, cancellation and no-response states. A reassuring reply may finish an administrative step, not independently declare clinical recovery. Platform manages live channels; Sahayak owns approvals and care status.
Acceptance: approval → delivery → reply → escalation/completion is observable and tested with live channels after platform readiness.

## Phase 5 — Medical reference and prescription checks
Survey: Research Assistant, Prescription Checker.
Reference: selected reliable sources, publication dates, evidence links, differences between guidelines/studies, explicit uncertainty. Patient-specific interpretation follows validation of the general reference tool. Never silently change clinic templates.
Medication checks: maintained suitable drug knowledge source, verified medicines/allergies and required patient information; supported duplicate/interaction/dose warnings with sources and recorded doctor decisions. An LLM alone is insufficient. Dependencies include knowledge licensing/coverage and clinical evaluation.

## Phase 6 — Ready-made clinic tasks and practice performance
Survey: Assistant marketplace, Practice Intelligence, insurance work.
Offer reviewed templates in plain English for reminders, reports, referrals, instructions and summaries. Platform builds/runs supported assistants; Sahayak authorises patient actions.
Measure missed visits, follow-up/referral completion, report backlogs, workload and assistant usage. Revenue/payments require billing data. Insurance begins with document/status tracking; submissions require insurer connections. Time saved uses measured activity and a documented baseline, never fabricated ROI.

## Sequence and release gates
Build the consultation → approved instructions → follow-up → patient reply → inbox → recorded doctor decision loop first. Pilot Phases 1–2 with a small clinic before expanding. Select initial specialty, representative report formats and external knowledge providers before estimating later phases. Each stage needs role/clinic isolation, source fidelity, consent and retry/concurrency checks, plus doctor usability review. Live platform/phone/WhatsApp readiness is separate from passing simulated tests.

## Implementation progress — 5 October 2026

This release supplies selected local workflows across all six phases. It does not complete every locally buildable roadmap feature, every AI capability in the survey, or clinical validation.

| Phase | Available in this repository | Boundary / remaining work |
| --- | --- | --- |
| 1. Doctor Inbox | Durable owner, acknowledgement, remind tomorrow/restore, assigned-to-me view, 50-item pages, urgent banner, source-specific handled action with a recorded reason; new messages reopen conversation work; new alerts invalidate older acknowledgements | External notifications and telephone escalation require delivery connections. The server currently aggregates clinic work before pagination; very large clinics need load testing and database-level pagination. |
| 2. Notes and instructions | Doctor dictation/typed notes include assessment, differential, investigations and instructions. Drafts preserve the original words. Instructions copy signed source sections, can be edited, require doctor approval, become read-only, and can be downloaded. A doctor can request translation drafts in nine language choices; the approved source remains beside the draft and every translation needs a separate review/approval | The model translation has numeric-preservation checks but still needs clinical language validation. Ambient transcription remains separate. No automatic medicines or prescriptions are invented. |
| 3. Patient history | Verified medicines/allergies/diagnoses in the pre-visit brief; structured dated records, source-report links, paged source-excerpt search, timeline, medication stop/error status, numeric report-table import as unverified entries, matching-unit/sample trends and latest/previous results in the pre-visit brief. Selectable text can be extracted locally from PDFs and shown beside the original | Scanned/image-only PDFs need OCR or manual entry. Extracted text is unverified and has no fabricated confidence score. Clinical interpretation and generated patient explanations remain unimplemented. No normality is inferred. |
| 4. Follow-up care | Versioned clinic templates, patient-specific draft editing and approval; multi-step plans, responsible doctor, pause/resume/cancel/close, inbox due work, manually recorded contact/reply/review, 48-hour reply deadline, no-response state/history, keyword-triggered urgent alerts, protection against finishing while the linked urgent alert is open | No automatic sending. End-to-end consent, quiet hours, delivery receipt/retry/failure and incoming channel replies must be connected and tested when the platform is ready. Keyword checks are not a complete clinical triage system. |
| 5. References and medicine checks | Live PubMed metadata search with explicit general-topic consent; dated source links; clinic reading list with review dates, editing and archive; exact ingredient duplicates and exact allergy-name matches over doctor-verified active records | No generated treatment recommendations or patient-specific research answer. No interaction, dose, brand-synonym, drug-class or organ-function checks. Full prescription checking requires a maintained drug knowledge source and clinical evaluation. The local checks concern the medicine record, not every field of a drafted prescription. |
| 6. Clinic work and performance | Approved versioned clinic templates, patient-specific drafts, structured insurer paperwork/correspondence history, visit/task/step/alert/report counts, defined no-show/referral/follow-up rates, consultation duration from explicit start/finish timestamps, distinct and returning patient counts, daily completed visits, charges, partial payments, duplicate-request protection and correction history | Insurer submissions, bank collection/reconciliation, platform execution metrics and measured time-saving ROI need their respective connections and data. Template triggers remain a platform/workflow-engine concern. |

### Where to try it

- `/doctor/inbox`: ownership, acknowledgement, defer/restore and original-source review.
- Open any patient from `/doctor`: **Before the consultation**, expanded note draft, and **Ongoing care**. Its sections contain history, report results, instructions, follow-up plans and charges.
- `/doctor/references`: search PubMed using a general topic only, and maintain clinic-reviewed sources.
- `/doctor/practice`: measured clinic activity and recorded payment totals.
- Visit completion checklist: also shows instruction drafts, plan drafts and unverified entries.

### Local implementation and data handling

- Migrations `015_clinic_workbench.sql`, `016_workbench_review_history.sql`, `017_clinic_billing.sql` and `019_workbench_corrections.sql` add clinic-scoped records. All new tables enforce row-level clinic isolation. Migration 018 belongs to separate WhatsApp setup work.
- Clinical write/read tools are doctor-only. Reception can see administrative checklist counts, without the new clinical text.
- Signed-source instructions are immutable after approval. Corrections to financial entries preserve history and do not initiate refunds or money transfers.
- Patient exports include new records. Erasure clears follow-up/inbox data, de-identifies billing and observes existing clinical retention holds for clinical entries and approved instructions.
- Tool audit records omit private instruction/reply/history content. Saved reference notes must contain no patient details.
- No AI-Agent-Platform files were changed for this implementation.

### Metric definitions

The selected period is a rolling 7, 30 or 90 days. Visits use check-in time; appointments use scheduled times that have passed; tasks use creation time; notes use signing time; follow-up steps use due time. These are current statuses of records in the selected period, not a historical snapshot of their status at an earlier date. Paused/cancelled plans can still contribute recorded step statuses.

Distinct patients means patients with a completed visit in the period. Returning means those patients also have a completed visit before the period; missing older data is not proof of a first-ever visit. Daily completed visits use the clinic's stored queue date. Urgent alerts, pending reports and outstanding balances are current all-time backlogs. Collected totals count recorded, non-corrected payment entries created in the period. Cancellation of a charge requires all active payment entries to be absent. No clinical outcome, adherence, bank balance or time saved is inferred from these numbers.

### Verification

See `docs/local-workflows.md` for the tested journeys, commands and operating limits. External live WhatsApp/phone delivery remains a separate acceptance test. Test fixtures and browser tests use synthetic patients; browser tests use a disposable database with live channels and real model calls disabled.

## Feature-by-feature audit — 5 October 2026

Checked against the backend tools, API routes, rendered-page source, migrations and existing test assertions. “Partial” means the exact survey promise is broader than the implemented capability; it does not mean the implemented subset is unusable.

| Survey feature | Status against full survey scope | Present | Missing |
| --- | --- | --- | --- |
| 1. Doctor Inbox | Local review workflow implemented; discovery partial | Source aggregation, urgency/due-date ordering, owner, acknowledge, defer/restore, handled reason, original-record links, insurance/result-review work, server-side category filtering and pagination | AI discovery/proposed actions across all conditions and automatic guideline-change alerts |
| 2. Clinical Scribe | Partial | Dictation/typed source → structured draft → doctor edit/sign; assessment, differential, tests and instruction headings | Ambient consultation capture; automatic linkage from dictated instructions into confirmed prescriptions/tasks |
| 3. Patient Follow-up Agent | Partial | Doctor-approved multi-step schedule, pause/resume/cancel, manual contact/reply entry, doctor completion | These plans are not connected to automatic delivery, incoming replies, delivery retries, quiet hours or a no-response state machine |
| 4. Ping the Doctor | Partial | Open urgent flags, follow-up keyword checks, persistent inbox, acknowledgement-age warning | Background notification escalation, complete contextual clinical triage, suggested clinical actions |
| 5. Research Assistant | Partial | PubMed publication metadata, source links/types/dates, reviewed reading list | Evidence synthesis, guideline comparisons/change detection, patient-specific answers, clinic-template comparison |
| 6. Patient-specific Brief | Partial | Concerns/intake, recent visits/notes/documents, verified medicine/allergy/diagnosis facts, outstanding tasks and latest/previous matching verified results | Interpreted clinical changes and a generated consultation agenda |
| 7. Medical Record Timeline | Partial | Paged dated source excerpts, medicine stop/error status, supported questions for medicines, allergies, changed medicines and outside-range results | Free-form semantic questions and generated explanations of treatment changes |
| 8. Prescription Checker | Partial | At draft/edit/sign time, exact prescribed-name matches against doctor-verified allergy/active-medicine records, duplicate lines and patient-entered allergy words | Interactions, doses, classes, brand mapping, age, pregnancy and organ-function checks require maintained clinical knowledge and validation |
| 9. Lab/Report Intelligence | Partial | Manual/pasted values, unverified import, original source, local selectable-PDF text extraction beside the original, trends, outside-range review inbox and recorded doctor decision | OCR for scans/images, clinical report interpretation and patient explanation. The app does not invent confidence values |
| 10. Patient Instructions | Partial | Signed-source copying, doctor edit/approval, immutable approved text/download, and AI translation drafts for English, Hindi, Hinglish, Marathi, Bengali, Tamil, Telugu, Kannada and Gujarati with source comparison and fresh approval | Clinical validation of translations and automatic plain-language rewriting. Additional advice/warnings are not generated |
| 11. WhatsApp | Setup and simulation; live delivery unverified | Existing consent/safety conversation logic, simulator and separate assisted connection setup | Verified real end-to-end delivery/replies through the platform. A connected setup status alone does not prove patient messaging works |
| 12. Doctor’s Daily Brief | Local recorded-data brief implemented | Today’s appointments/queue, inbox attention, follow-ups due, no replies, messages, report/referral tasks, insurance cases, outside-range result review and stale references; refresh every 30 seconds | Generated clinical agenda and external notification delivery |
| 13. Agents marketplace / build your workflow | Local template library implemented; platform catalogue partial | Immutable versions, approval/retirement, relative schedules, idempotent patient draft creation, patient-specific edits and separate plan approval | Event/condition/action execution and the full platform-run clinical agent catalogue |
| 14. Practice Intelligence | Local measurable subset implemented | Defined no-show/referral/follow-up rates with denominators; explicit consultation duration; collection per paying patient; backlog, distinct/returning patients, daily visits and payment corrections | Adherence/clinical outcomes, platform assistant usage and measured time-saving ROI |

### Evidence locations

- Inbox: [backend](../packages/core/src/tools/inbox.ts), [screen](../apps/web/app/doctor/inbox/page.tsx), [tests](../packages/core/test/inbox.test.ts).
- Notes: [scribe](../packages/agents/src/agents/scribe.ts), [record tools](../packages/core/src/tools/records.ts), [scribe tests](../packages/agents/test/scribe.test.ts).
- Brief/checklist: [care tools](../packages/core/src/tools/care.ts), [brief UI](../apps/web/app/components/PrevisitBrief.tsx), [checklist UI](../apps/web/app/components/VisitChecklist.tsx).
- History, instructions, follow-up, medicine checks and billing: [tools](../packages/core/src/tools/clinical-workbench.ts), [patient UI](../apps/web/app/components/ClinicalWorkspace.tsx), [integration tests](../packages/core/test/workbench.test.ts), [browser tests](../e2e/workbench.spec.ts).
- References: [PubMed search](../packages/core/src/tools/reference-search.ts), [screen](../apps/web/app/doctor/references/page.tsx).
- Daily brief and analytics: [doctor dashboard](../apps/web/app/doctor/page.tsx), [attention summary](../apps/web/app/components/AttentionSummary.tsx), [clinic overview](../apps/web/app/doctor/practice/page.tsx).
- Channels: [assisted setup boundaries](WHATSAPP_ASSISTED_SETUP.md).

### Remaining work that does not require AI-Agent-Platform

These are genuine local development gaps, not platform blockers:

1. OCR for scanned/image reports, followed by representative-format validation. Selectable-PDF extraction is implemented locally.
2. Broader source-grounded semantic questions and summaries. The current record browser answers a bounded set of supported fact queries and shows original excerpts.
3. Clinically validated plain-language rewriting and translation evaluation. Doctor-reviewed translation drafts are implemented, but numeric preservation alone cannot prove meaning.
4. More complete longitudinal visualization and event-specific indexes for very large clinics. Inbox filtering/pagination is now database-backed; patient record search is paged.
5. Locally measured time baselines for ROI. Consultation timing now has an explicit start timestamp, but time saved cannot be inferred without a baseline study.

Full interaction/dose checks additionally need a maintained clinical knowledge source and clinical validation. Live WhatsApp/phone delivery and platform-run agents have separate platform/provider dependencies. Insurer submissions and payment collection have separate external-service dependencies.

### Verification for this recheck

Re-ran five targeted suites: **37 tests passed** covering workbench workflows, care/checklist/waitlist, inbox, reference search and scribe. The earlier 362-test suite and browser results above are historical results from the preceding implementation turn; they were not all rerun for this audit. This recheck updates documentation and completion claims; it does not implement the missing items listed here.
