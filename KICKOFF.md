# Sahayak — Claude Code kickoff prompt

> **How to use this file**
> 1. Create an empty project folder (or Git repo) called `sahayak`.
> 2. Export the Sahayak product plan doc as Markdown and save it in that folder as `docs/sahayak-product-plan.md`.
> 3. Save this file in the same folder as `KICKOFF.md`.
> 4. Open Claude Code in that folder and say:
>    **"Read KICKOFF.md and docs/sahayak-product-plan.md, then start with Milestone 0. Show me your plan before writing code."**
>
> Everything below the line is the prompt Claude Code works from.

---

## 1. What you are building

You are the lead engineer for **Sahayak** (Hindi for "helper"): a team of AI agents that runs the front desk of a small clinic or nursing home in India. The goal is for a doctor to need **one receptionist instead of three or four**.

Agents handle patient check-in, the live queue, appointment booking, WhatsApp replies, schedule changes ("doctor running 30 minutes late"), follow-ups and new enquiries. The one remaining receptionist supervises and handles anything the agents flag.

The full product plan is in `docs/sahayak-product-plan.md`. Treat it as the source of truth for product behaviour. If this file and the plan disagree, ask me.

## 2. Fixed decisions (do not change without asking)

- **No change to the clinic's existing software.** The clinic keeps using its own system for prescriptions, records and billing. Sahayak runs alongside it, as a standalone system with its own appointments, queue and patient contacts.
- **No finance in release 1.** No payments, UPI, invoices, refunds or GST. Don't build payment tables or screens.
- **Languages: Hindi and English only.** All patient-facing text must exist in both. Store strings in translation files, never hard-coded.
- **LLM: NVIDIA Nemotron 3 Ultra** (`nemotron-3-ultra-550b-a55b`), called through NVIDIA's hosted OpenAI-compatible API. Wrap it behind our own `LlmProvider` interface so the model can be swapped or self-hosted later. Read the API key and base URL from environment variables. Never commit keys.
- **Agents act only through tools.** An agent never writes to the database directly. It calls named tools (`book_appointment`, `issue_token`, `call_next_patient`, `shift_schedule`, `flag_to_receptionist`, …). Each tool validates input, checks permissions and writes an audit log entry.
- **Agents never give medical advice.** Red-flag symptoms always escalate to a human (Section 5 below).
- **Modular by design.** Build an agent core, a tool layer and pluggable modules, so new modules (prescriptions, records, payments) can be added later without rebuilding the agents. Each module owns its data, tools and screens, and can be switched on or off per clinic.

## 3. Tech stack

Use the stack below unless you have a strong reason not to; if you do, tell me why before changing it.

| Layer | Choice |
| --- | --- |
| Monorepo | pnpm workspaces, TypeScript everywhere |
| Clinic screens | Next.js + React (doctor screen, receptionist console, waiting-room TV, patient check-in page) |
| API and core | Fastify + TypeScript, REST + WebSockets |
| Database | PostgreSQL with row-level security per clinic (`clinic_id` on every tenant table) |
| Live updates / cache | Redis (queue fan-out to screens) |
| Background jobs | pg-boss (reminders, follow-ups, retries) |
| Validation and contracts | Zod schemas shared between frontend, API and agent tools |
| Tests | Vitest for unit tests, Playwright for the main end-to-end flows |
| Local setup | `docker compose up` brings up Postgres, Redis, API and web, with seed data |

**Channels in release 1 are adapters behind interfaces:** `MessagingChannel` (WhatsApp), `VoiceChannel` (phone). For now build a **mock WhatsApp simulator**, a web page that looks like a phone chat, so the demo works without vendor accounts. Real WhatsApp Business and telephony vendors will be plugged in later. Don't pick vendors without asking me.

## 4. The agents (release 1)

Build these on one shared **orchestrator**, which routes each patient conversation to the right agent, keeps one conversation record and sends flags to the receptionist console.

| Agent | Job | Must never |
| --- | --- | --- |
| Check-in | QR scan → register new patient (with consent) or recognise a returning one by phone number → issue token | Collect more data than needed; skip consent |
| Queue | Keep the order, estimate waits, call the next patient on WhatsApp and TV, handle no-shows | Reorder the queue on a patient's request |
| Intake | Ask the clinic's standard questions while the patient waits; summarise for the doctor | Diagnose, suggest medicine, reassure about symptoms |
| WhatsApp front desk | Answer timings, directions and availability from clinic settings; book, move or cancel appointments | Answer anything not in clinic settings; give medical advice |
| Schedule | Doctor says "running 30 min late" (text or voice note) → compute the impact → **doctor confirms with one tap** → notify every affected patient, offer new slots, rebook | Send anything before the doctor confirms |
| Follow-up | Reminders and post-visit check-ins the doctor configured | Change a treatment plan; ignore worsening symptoms |
| Leads | Reply to new enquiries quickly and book them; recall patients due for review | Message patients without consent |
| Records (light) | Show past Sahayak visits, intake summaries and reports uploaded by photo | Show one patient's data to another |

The voice agent and the doctor's agent builder come **after** the pilot. Design the orchestrator and tools so both can be added later, but don't build them now.

## 5. Safety rules (enforced in code, not only in prompts)

1. **Red-flag detection runs on every patient message**, before the LLM replies. Use two layers: a deterministic Hindi + English keyword/phrase list (chest pain / *seene mein dard*, breathlessness / *saans phoolna*, heavy bleeding, unconscious, stroke signs, seizure, pregnancy complications, high fever in an infant, suicidal thoughts, poisoning), plus an LLM classifier as a second check. Either one triggering counts as a red flag.
2. On a red flag: send the patient a fixed message (go to emergency or call 108), raise a loud alert on the receptionist console, and notify the doctor. Clinics can **add** phrases to the list, never remove them.
3. A fixed reply for medical questions: *"I can't advise on that, but I've told the doctor's team right away."*, plus its Hindi version.
4. **Human handoff:** "talk to a person" or an upset patient goes to the receptionist console.
5. **Fail safe:** if the LLM is down or slow (time limit), check-in and queue keep working as plain software, and the console shows a banner.
6. **Audit everything:** every agent message, tool call and decision is logged with its clinic, patient, agent and timestamp.
7. **Privacy (India's DPDP Act):** record consent at check-in, collect minimal data, keep each clinic's data separate through row-level security, and never put patient data in logs sent to third parties.

Write automated tests for rules 1, 2, 5 and the clinic data separation. These tests must stay green.

## 6. Milestones

Work one milestone at a time. At the start of each, **show me a short plan and wait for my OK**. At the end, give me a summary, how to run it, and what is left.

### Milestone 0 — Foundations
- Monorepo, Docker Compose, linting, formatting, CI test script.
- Database schema and migrations: clinics, doctors, staff users, patients, consents, appointments, queue entries, conversations, messages, agent actions (audit), clinic settings, red-flag phrases.
- Row-level security per clinic, with tests proving one clinic can't read another's data.
- Auth for clinic staff (doctor, receptionist roles).
- Seed data: one demo clinic ("Dr. Sharma's Clinic"), two doctors, 25 appointments for today.
- Write a `CLAUDE.md` with project conventions, commands and the fixed decisions above.

### Milestone 1 — Clickable demo (the pitch demo)
- Patient check-in page reached by QR (Hindi/English toggle) → consent → token.
- Waiting-room TV page: now serving, next three, estimated wait, QR code.
- Doctor screen: big **Next patient** button, patient card, Skip, Hold, today at a glance.
- Receptionist console: live queue, manual check-in, flags list, take over a conversation.
- WhatsApp simulator page.
- Live updates over WebSockets.
- No LLM yet. Use scripted responses so the demo works offline.

### Milestone 2 — Agent core + first agents
- `LlmProvider` interface + Nemotron 3 Ultra implementation (OpenAI-compatible client, tool calling, timeouts, retries).
- Orchestrator, tool layer (Zod-validated tools with permission checks and audit), red-flag pipeline.
- Check-in, Queue, Intake and WhatsApp front-desk agents working through the simulator.
- An eval script: around 50 sample patient messages in Hindi and English, including red flags and medical-advice traps. Report pass/fail per safety rule.

### Milestone 3 — Schedule, follow-up and leads agents
- "Running late" flow end to end: doctor message → impact summary → one-tap confirm → notifications → patient replies → rebooking → live summary for the doctor.
- Follow-up reminders using pg-boss jobs.
- Leads agent replying to enquiries in the simulator.
- Playwright end-to-end tests for: new patient journey, running-late flow, red-flag escalation.

### Later (do not start without my go-ahead)
Real WhatsApp vendor, voice agent with Hindi speech-to-text and text-to-speech, doctor's agent builder, the import/export link with clinic software, then optional modules (voice prescriptions, records, payments).

## 7. How I want you to work

- Ask before making product decisions the plan doesn't cover. Make technical decisions yourself and note them in `docs/decisions.md`.
- Keep the code simple and readable. I'm not deeply technical, so explain what you built in plain language at the end of each milestone.
- Commit in small, clearly described steps.
- Never put real patient data, API keys or secrets in the repo. Use `.env.example`.
- Every patient-facing message must exist in both Hindi and English.
- If something in this file looks wrong or unsafe, tell me instead of working around it.

Start now: read `docs/sahayak-product-plan.md`, then show me your plan for **Milestone 0**.
