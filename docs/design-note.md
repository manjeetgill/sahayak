# Sahayak design note

**Status:** Proposed design direction
**Scope:** Product design only
**Reviewed:** 5 October 2026

## 1. Product experience goal

Sahayak should feel like one calm clinic workspace. A doctor or receptionist should immediately understand:

1. What needs attention now?
2. Which patient is next?
3. What action should I take?
4. Did the action finish successfully?

The product should use ordinary clinic language. Provider names, API keys, webhooks, agent configuration, platform execution details and other implementation concepts should remain inside setup-team disclosures.

The visual direction should communicate trust, clarity and speed. “Top-notch” should come from strong hierarchy and predictable interactions rather than decorative effects.

## 2. Findings from the current product

### What is already working well

- Forms generally have visible labels and understandable button text.
- Safety explanations are present near clinical actions.
- Doctor approval is clearly required for notes, instructions and follow-up plans.
- Public check-in and waiting-room experiences are intentionally simple.
- Hindi and English are considered in patient-facing workflows.
- The system already distinguishes doctor, reception and patient capabilities.

### Main experience problems

#### The application does not yet feel like one workspace

Most screens have their own header and a back link. Navigation changes between pages, so users must remember where they came from. A persistent application shell would provide location, patient search, notifications and role context everywhere.

#### The doctor dashboard gives equal visual weight to unrelated work

Outstanding work, clinic questions, patient search, running-late controls, the queue and daily statistics compete for attention. The most important action—care requiring review—should lead the page.

#### The patient record is too long

Pre-visit information, tasks, dictation, signed notes, prescriptions, reports, clinical history, instructions, care plans, insurance and billing appear on one continuous page. The screen is comprehensive but difficult to scan during a consultation.

#### Settings mix everyday clinic choices with technical administration

Clinic information, timings, intake questions, FAQs, follow-up timing, reputation, doctor details, WhatsApp numbers, retention, assistants, integrations and emergency phrases appear together. These need clear sections and independent save states.

#### The assistant screen repeats setup information after connection

When WhatsApp is live, doctors still see setup explanations and progress. The live state should show service health, enabled patient tasks and simple test/pause actions. Technical setup belongs in a collapsed setup-team section.

#### Desktop space is underused

Many screens use a narrow single-column layout. That works on mobile but leaves large empty areas on desktop. Clinical review benefits from a wider content area, a main column and a contextual side panel.

#### Status presentation is inconsistent

Some states use tags, some use paragraphs, and others appear only in button labels. All workflows should use the same status vocabulary and visual treatment.

## 3. Information architecture

Use five primary destinations for doctors.

| Destination | Purpose | Current screens brought together |
| --- | --- | --- |
| **Today** | Immediate priorities and the live clinic | Doctor dashboard, needs-attention summary, live queue |
| **Patients** | Find a patient and work in one patient record | Patient search, patient profile and visit workspace |
| **Care** | Follow-through across patients | Inbox, care tasks, waiting list and reusable care plans |
| **Assistants** | Patient communication and routine clinic help | WhatsApp, phone, reminders and assistant activity |
| **Clinic** | Clinic-wide administration and assurance | Overview, references, settings, team, safety and connected software |

### Global application shell

Desktop:

- Left navigation with clinic name, signed-in role and five destinations.
- Global patient and task search in the top bar.
- Help and account menu at the top right.
- Main content area with a maximum readable width but enough room for two-column clinical layouts.

Mobile and narrow tablet:

- Compact top bar with clinic name, search and account.
- Bottom navigation for Today, Patients, Care and Assistants.
- Clinic settings in the account menu.
- Primary action remains visible near the top of each screen rather than floating over clinical information.

## 4. Design principles

### One primary action per screen

The action that advances the current workflow receives the filled primary button. Other actions use secondary or text styles.

Examples:

- Today: **Call next patient**
- Patient visit: **Continue visit** or **Complete visit**
- WhatsApp enabled: **Open practice chat**
- Reusable plan draft: **Save version for review**

### Source before summary

Clinical summaries should link directly to the originating note, message, report or task. A summary must never visually appear more authoritative than its source.

### Progressive disclosure

Show the minimum information needed for the current decision. Put uncommon configuration, technical details, history and advanced controls behind clearly labelled sections.

### Stable status language

Use these shared workflow states:

- **Draft**
- **Needs review**
- **Ready**
- **Live**
- **Paused**
- **Needs attention**
- **Completed**
- **Cancelled**

Status must always include text. Colour may support the meaning but cannot carry it alone.

### Calm visual hierarchy

- Use deep clinic green for primary actions and active navigation.
- Use red only for urgent clinical or safety work.
- Use amber for overdue, incomplete or warning states.
- Use neutral surfaces for ordinary information.
- Avoid pulsing animation except when essential for a newly arrived urgent alert; respect reduced-motion settings.

### Explain at the moment of decision

Short supporting text should appear next to irreversible or clinically meaningful actions. Long operating explanations should move to contextual help.

## 5. Screen designs

## 5.1 Today

### Purpose

Give the doctor one view of the live clinic and the work that needs a decision.

### Layout

Header:

- Date and doctor greeting.
- One primary **Call next patient** button.
- If nobody is waiting, replace it with a clear empty state.

Main column:

1. **Needs your attention**
   - Urgent messages first.
   - Overdue results, reports and care work next.
   - Unsigned personal drafts after clinic-wide work.
   - Every item shows patient, reason, age/due time and **Open source**.
2. **Waiting room**
   - Token, patient, visit type and wait time.
   - Call or resume the appropriate patient.

Side column:

- Today totals: booked, seen and waiting.
- Running-late control with **Check impact** before sending.
- Quick actions: find patient, create task and ask about clinic activity.

### Remove or relocate

- Move reusable care plans, references, overview, settings and safety out of the dashboard header.
- Keep “Ask your clinic” as a quick action or command palette rather than a large permanent dashboard section.

## 5.2 Needs attention

### Purpose

Provide one review queue without hiding urgent work.

### Design

- Keep a permanent clinic-wide urgent count.
- Use view tabs: **All**, **Mine**, **Remind later**, **Completed recently**.
- Use filter chips for Messages, Results, Reports, Follow-up, Insurance and Drafts.
- Each row shows one plain reason, its source, owner, due time and next valid action.
- Opening an item shows the source in a right-side drawer on desktop and a full screen on mobile.
- Acknowledgement, assignment and reminder actions stay secondary.
- “Handled” appears only when that action is valid for the source record.

## 5.3 Patients

### Patient finder

- Search by name or phone from the persistent top search.
- Recent patients and today’s patients appear before an empty search.
- Results show name, phone suffix, last visit and outstanding-work count.

### Patient header

The patient header stays consistent across patient tabs:

- Patient name and phone.
- Latest visit and assigned doctor.
- Important recorded alerts.
- Open task count.
- Current primary action, such as **Start visit** or **Continue visit**.

### Patient tabs

#### Overview

- Pre-visit concern and answers.
- Verified medicines and allergies.
- Latest matching results.
- Recent visits and signed notes.
- Outstanding care tasks.

#### Visit

- Dictation and structured note editor.
- Source words always accessible.
- Visit completion checklist in a side panel.
- Draft prescriptions, certificates and instructions associated with the visit.

#### Care plan

- Active plan and next step first.
- Reusable-plan application and patient-specific editing.
- Contact, reply, no-response and doctor-review history.
- Result-review and referral tasks.

#### Records

- Chronological timeline.
- Filters for medicines, allergies, diagnoses, results, referrals and documents.
- Source-linked record search.
- Original report beside extracted text.

#### Documents and billing

- Uploaded records.
- Signed prescriptions and certificates.
- Insurance paperwork.
- Charges, payments and correction history.

## 5.4 Care

Care is the cross-patient follow-through area.

Use four local tabs:

- **Open work** — reports, referrals, instructions and follow-ups.
- **Waiting list** — opted-in patients and active offers.
- **Reusable plans** — approved clinic schedules and version history.
- **Completed** — recently closed work for confirmation and recovery.

### Open work

- Default order: urgent, overdue, due today and upcoming.
- Filters for owner, task type and status.
- Show the current stage in plain words: Requested → Received → Reviewed → Patient informed.

### Waiting list

- Separate “Add patient” from the list of waiting patients.
- Show eligibility and consent before an offer is sent.
- Use an offer timer and clearly show whether a slot is reserved.
- Explain double-booking protection near the action, not as a long introductory paragraph.

### Reusable plans

- Library list on the left or top, selected plan details on the right or below.
- Show title, current version, approval status and number of steps.
- Creating a revision must visibly preserve the approved version.
- Keep patient names out of the template area.

## 5.5 Assistants

Use plain-language tabs:

- **Everyday help**
- **WhatsApp**
- **Phone calls**
- **Reminders and updates**

### Everyday help

Show a short list of clinic outcomes rather than agent types:

- Book and manage appointments.
- Answer clinic questions.
- Collect before-visit answers.
- Send approved reminders.
- Escalate urgent messages to staff.

Each task has a plain On/Off state, one-sentence explanation and link to the clinic information it uses.

### WhatsApp when enabled

This should be the default connected-state design:

**WhatsApp is live**

- Masked clinic number.
- “Connected through your clinic agent service.”
- Last successful connection check.
- Current patient tasks enabled on WhatsApp.
- Primary action: **Open practice chat**.
- Secondary action: **Check live connection**.
- Destructive secondary action: **Pause replies**.

Do not show setup steps, OTP explanations, webhook language, provider configuration or authorization guidance in the main live state.

A collapsed **Setup details** section may contain:

- Connection provider.
- Channel identifier.
- Verification state.
- Last error.
- Setup-team troubleshooting instructions.

### WhatsApp setup states

Use a short state-specific screen rather than showing every possible step simultaneously:

1. Number required.
2. Owner authorization required.
3. Verification in progress.
4. Ready for test.
5. Live.
6. Temporarily unavailable.

Each state has one primary action and a short description of what happens next.

### Phone calls

- Clearly distinguish browser practice from a real telephone connection.
- When no phone provider is connected, say **Practice calls available; clinic phone connection not set up**.
- Keep provider and webhook details inside setup-team information.

### Reminders and updates

- Start with reviewed examples.
- Let the doctor describe the desired outcome in plain words.
- Preview audience, timing and exact message before approval.
- Show which live channel will deliver the message.
- If no live channel is available, allow saving a draft but explain that nothing will be delivered.

## 5.6 Clinic

Clinic contains administration and assurance.

### Sections

- **Clinic details** — address, phone, directions and public description.
- **Opening hours** — weekly visual schedule rather than seven free-text fields.
- **Doctors and team** — doctor hours, slot length, professional details and staff access.
- **Patient questions** — before-visit questions and clinic FAQs.
- **Notifications** — reminders, follow-up timing and daily summary.
- **Public page** — page preview, review link and rating choices.
- **Privacy** — retention and patient data requests.
- **Safety** — emergency phrases, protections and activity history.
- **Connected software** — API keys and update connections for the setup team.

### Save behavior

Each section saves independently and visibly shows one state:

- Saved.
- Unsaved changes.
- Saving.
- Could not save.

Avoid multiple identical “Save” buttons without section context.

## 5.7 Clinic overview

Replace long metric paragraphs with a compact, honest overview:

- Work needing attention now.
- Visits and patients seen.
- No-show rate with numerator and denominator.
- Follow-up and referral completion with denominators.
- Recorded consultation duration and sample size.
- Payments recorded and outstanding.

Every measure should include a short definition or expandable explanation. Never imply clinical outcome or ROI.

## 5.8 Medical reference

- Place the general-topic privacy confirmation beside the search action.
- Show publication results as a readable list with title, source type, date and original link.
- Separate search results from the clinic-reviewed reading list.
- Use **Add to clinic reading list** as the result action.
- Make “general information only” visible without repeating it in every row.

## 5.9 Safety report

Provide two levels:

### Clinic assurance

- Plain-language safety protections.
- Latest evaluation result.
- Urgent alert handling measures.
- Delivery failures and assistant problems.

### Setup-team details

- Technical policy identifiers.
- Actor IDs.
- Raw activity payloads.
- API and integration activity.

Doctors should see staff names and understandable actions instead of raw UUIDs wherever an identity is available.

## 5.10 Reception workspace

Reception should have its own focused navigation:

- **Today**
- **Conversations**
- **Waiting list**
- **Privacy requests**

### Reception Today

- Waiting patients and live queue.
- Check-in action.
- Administrative messages needing attention.
- Next available appointments.

Clinical note content, prescription tools, medical references and doctor-only review controls remain hidden.

## 5.11 Public clinic page

Recommended hierarchy:

1. Clinic name, open/closed state and primary **Book appointment** button.
2. **Check in for today’s visit** as a separate action.
3. Doctors and specialties.
4. Hours.
5. Address, directions and phone.
6. Verified clinic rating only when the display threshold is met.

The current “Book an appointment” heading should become an actual booking action or WhatsApp contact button rather than a heading without a direct booking control.

## 5.12 Patient check-in

Use a short visible progression:

1. Phone number.
2. Confirm patient.
3. Choose doctor or appointment.
4. Consent and confirmation.
5. Token and estimated wait.

Keep Hindi/English switching visible throughout the flow. Preserve entered information when switching language.

## 5.13 Waiting-room TV and poster

### TV

- Clinic name and live clock at the top.
- Separate large doctor columns.
- One dominant “Now serving” token per doctor.
- Next tokens below it.
- Estimated wait expressed as approximate.
- Persistent check-in QR code in a quiet corner.
- Avoid patient names.

### Poster

- Strong QR code hierarchy.
- Clinic name and simple bilingual instruction.
- Short fallback URL and clinic phone.
- Print-safe black-and-white rendering.

## 5.14 Practice simulators

WhatsApp and phone simulators are staff testing tools. They should live under Assistants rather than being promoted from the public home page.

Each simulator should show:

- **Practice only** status.
- Whether test records will be saved.
- Whether the configured AI service will receive the sample.
- A reset conversation action.
- Suggested safe examples.

## 5.15 Signup and setup

### Signup

- Ask only for invite code, clinic name, doctor name, email and password.
- Explain password requirements before submission.
- Show progress immediately after clinic creation.

### Setup wizard

Keep the seven-step structure, but use:

- Completed checkmarks.
- Current-step description.
- Clear validation near fields.
- Back and Save-and-continue actions.
- Preview public page and assistant behavior before going live.
- Final checklist separating what works locally from live WhatsApp/phone readiness.

## 6. Component system

Build a small shared component set before redesigning individual pages.

### Application components

- App shell.
- Primary navigation.
- Top search.
- Page header.
- Patient context header.
- Tabs.
- Source-linked work item.
- Status label.
- Empty state.
- Side review drawer.
- Confirmation dialog.
- Save-state indicator.
- Metric with definition.
- Timeline entry.

### Form components

- Label, help text and error.
- Text, phone, number, date and time fields.
- Select and searchable select.
- Checkbox and switch.
- Field group.
- Repeating rows for questions, FAQs and plan steps.
- Primary, secondary, quiet and destructive buttons.

### Status colours

| Meaning | Treatment |
| --- | --- |
| Active, complete or safe connection | Green plus text/icon |
| Needs review or due soon | Amber plus text/icon |
| Urgent clinical or delivery failure | Red plus text/icon |
| Draft, paused or inactive | Neutral plus text/icon |
| Informational | Blue-grey plus text/icon |

## 7. Typography and spacing

- Use a highly readable UI typeface with Devanagari support.
- Body text should normally be 15–16 px.
- Supporting text should not be smaller than 12 px.
- Use 44 px minimum interactive targets on touch screens.
- Prefer a 4/8 px spacing system.
- Keep paragraphs between 55 and 75 characters wide where possible.
- Use sentence case throughout.
- Avoid all-caps labels except short optional eyebrows.

## 8. Responsive behavior

### Desktop

- Persistent left navigation.
- Main and contextual side columns.
- Source review can open beside the current workflow.
- Tables may show several columns.

### Tablet

- Collapsible navigation.
- Main content remains full width.
- Context panels move below or open as drawers.

### Mobile

- Bottom navigation.
- Patient tabs scroll horizontally with clear active state.
- Tables become labelled rows.
- Primary action remains near the page heading.
- No essential action depends on hover.

## 9. Accessibility requirements

- Meet WCAG 2.2 AA contrast.
- Preserve visible keyboard focus.
- Use semantic headings in logical order.
- Associate every field with a persistent label.
- Announce save, loading and error states appropriately.
- Do not rely on colour alone.
- Support browser zoom to 200% without losing actions.
- Respect reduced motion.
- Keep urgent banners readable without continuous flashing.
- Provide English and Hindi language names in their own scripts.

## 10. Content guidelines

### Preferred language

- “Needs your attention” instead of “Inbox aggregation.”
- “Reusable care plans” instead of “Templates engine.”
- “Connected software” instead of “Integrations.”
- “Reminders and updates” instead of “Automations.”
- “Clinic assistants” instead of “Agents.”
- “Check live connection” instead of “Refresh provider status.”
- “Open original report” instead of “View source artifact.”

### Message structure

1. What happened.
2. What the user should do.
3. What happens next.

Example:

> The report was saved. Review it against the original, then record your decision.

Avoid repeating technical limitations on every screen. Put durable explanations in contextual help and show short safety reminders where decisions occur.

## 11. Empty, loading and failure states

Every major screen needs intentional states.

### Empty

Say what the screen will contain and provide the next useful action.

### Loading

Keep the page structure visible and label what is being checked.

### Failure

Preserve entered work where possible. Explain whether the action was saved and provide a safe retry.

### Connection unavailable

For WhatsApp:

> WhatsApp status cannot be checked right now. Your saved clinic number is unchanged. Patient replies are shown as unavailable until the connection is verified again.

Do not display a green live state using only previously saved status when the current connection cannot be verified.

## 12. Recommended implementation order

### Stage 1 — Foundations

1. Design tokens, typography and spacing.
2. App shell and responsive navigation.
3. Shared buttons, fields, statuses and empty/error states.
4. Page header and patient context header.

### Stage 2 — Highest-frequency workflows

1. Today dashboard.
2. Needs-attention queue.
3. Patient overview and visit tabs.
4. Reception Today and Conversations.

### Stage 3 — Follow-through

1. Care hub.
2. Reusable care plans.
3. Waiting list.
4. Result and insurance review.

### Stage 4 — Assistants

1. Enabled WhatsApp state.
2. WhatsApp setup states.
3. Everyday clinic tasks.
4. Phone practice and real-connection boundary.
5. Reminder preview and approval.

### Stage 5 — Clinic administration

1. Settings sections and save states.
2. Clinic overview.
3. Safety report.
4. Connected software.
5. References.

### Stage 6 — Patient-facing polish

1. Public clinic page.
2. Check-in.
3. Waiting-room TV and poster.
4. Signup and setup wizard.

## 13. Design acceptance checklist

A redesigned screen is ready to build only when:

- The user can identify the primary action within a few seconds.
- The current clinic, role, patient and workflow location are clear.
- Urgent work is visible without making the whole product feel alarming.
- Clinical summaries link to sources.
- Loading, empty, error and success states are defined.
- Doctor and reception permissions are reflected in the interface.
- Desktop and mobile behavior are specified.
- Keyboard, screen-reader and touch behavior are considered.
- Technical setup language is hidden from ordinary clinic work.
- No visual element suggests an unverified clinical conclusion.

## 14. Final recommendation

Start with the application shell, Today and the patient record. Those changes will improve almost every daily doctor interaction and establish the component system needed by the remaining screens.

For the already-enabled WhatsApp assistant, build the connected-state design first: one live status, enabled clinic tasks, a practice test, a connection check and a pause control. Keep setup-team information collapsed. This provides immediate clarity without changing the underlying agent behavior.

## 15. Implemented screen coverage — 5 October 2026

The linked prototype's 30 screen states now have a corresponding application view. Real clinic data, existing permissions and the existing operations are retained. Patient subviews use separate visible tab panels while keeping drafts mounted in the same record. Reception Today and Conversations are separate views. Settings show one selected section. The dashboard places attention and waiting patients on the left, with daily counts, delays and quick actions on the right. Original dictation and the structured draft appear alongside one another on desktop.

| Designed screen | Application location |
| --- | --- |
| Welcome | `/` |
| Staff sign-in | `/login` |
| Doctor Today | `/doctor` |
| Doctor Attention | `/doctor/inbox` |
| Patient Overview | `/doctor/patients/:id#patient-overview` |
| Patient Visit | `/doctor/patients/:id#note-composer` |
| Patient Records | `/doctor/patients/:id#documents` |
| Patient Documents & billing | `/doctor/patients/:id#patient-administration` |
| Care Open work | `/doctor/care` |
| Care Waiting list | `/doctor/waitlist` |
| Care Reusable plans | `/doctor/templates` |
| Assistants Everyday help | `/doctor/agents`, Everyday help tab |
| Assistants WhatsApp | `/doctor/agents`, WhatsApp tab |
| Assistants Phone | `/doctor/agents`, Phone calls tab |
| Assistants Reminders | `/doctor/agents`, Reminders & updates tab |
| Practice chat | `/c/:slug/sim` |
| Clinic Overview | `/doctor/practice` |
| Medical reference | `/doctor/references` |
| Clinic Settings | `/doctor/settings` |
| Safety report | `/safety` |
| Connected software | `/doctor/integrations` |
| Reception Today | `/console` |
| Reception Conversations | `/console#conversations` |
| Reception Privacy requests | `/console/privacy` |
| Public clinic page | `/c/:slug` |
| Patient check-in | `/c/:slug/checkin` |
| Waiting-room TV | `/c/:slug/tv` |
| Check-in poster | `/c/:slug/poster` |
| Create clinic | `/signup` |
| Clinic setup wizard | `/setup`, all seven steps |

Additional coverage includes the existing phone practice screen and patient Care plan section. The responsive browser check in `e2e/design-screens.spec.ts` visits these states at 1440px and 390px, checks for horizontal page overflow, and captures screenshots. These checks validate navigation and responsive rendering; they are not pixel-difference tests against the illustrative prototype. Connection status and sample content deliberately reflect the actual environment, not prototype examples.

### Layout correction verification

Compared the desktop Today, patient overview and Reception screenshots with the linked prototype at a matching 1440 × 960 viewport. Browser coverage checks all listed states at desktop and mobile widths, including patient panel visibility. Workflow regression results: 18 checks passed on the full run; the two tests using old navigation selectors passed on their targeted rerun. Type checking passed; lint has no errors and five existing warnings outside the changed screens. This is visual review and functional verification, not a claim of pixel-identical rendering.
