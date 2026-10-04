# Technical decisions

Product decisions not covered by the plan are listed under "Open questions" for the owner.

## Architecture

- **Tool layer is the only write path for agents and staff screens** (`callTool` in `packages/core/src/tools/registry.ts`). It validates, checks the actor's allow-list (`staff:doctor`, `agent:queue`, `patient`, `system`...), checks the clinic's module switch, runs in a clinic-scoped transaction, writes `agent_actions`, and publishes live events only after commit. Failed and denied calls are audited too.
- **Row-level security via a session setting.** Each transaction does `set_config('app.clinic_id', ..., true)`; policies compare `clinic_id` to it. The app role is non-superuser and policies are `FORCE`d, so a missing context returns zero rows (fails closed). Staff login uses a small `SECURITY DEFINER` function because no clinic is known yet. Background workers list work with `SECURITY DEFINER` functions that return ids only (`due_followups`, `clinics_for_sweeps`) and then act inside each clinic's scope.
- **Audit log is append-only** for the app role (UPDATE/DELETE revoked).
- **Orchestrator pipeline order:** store message, human-owned? stop, red-flag check, human handoff/upset, medical question, queue-jump refusal, continue active flow, route by intent. Any exception sends a safe fallback reply and flags the receptionist (never silence).
- **LLM is optional.** Booking, queue, intake, check-in and the running-late flow are deterministic state machines; the LLM is used for the second red-flag layer, free-form clinic questions (tool loop restricted to `get_clinic_info`, `list_free_slots`, `flag_to_receptionist`), intake summaries and unusual "running late" phrasing. All LLM text passes a medical-policy output filter. `LlmGate` marks the model down after 2 consecutive failures for 30s and emits `llm_status`.
- **Mock WhatsApp:** the stored `messages` row is the delivery; the simulator page reads it and refreshes on WebSocket events. A real vendor adapter implements `MessagingChannel.send`. Sending happens inside the tool transaction for now; a real adapter should switch to an outbox + job so a vendor call never holds a DB transaction.
- **Events:** Redis pub/sub when reachable, otherwise in-process. Public screens (TV, simulator) get only `queue_changed` / `conversation_updated` (no data); staff sockets get everything for their clinic.
- **Auth:** scrypt password hashes, JWT bearer (12h) held in browser storage. For a real deployment move to httpOnly cookies and add rate limiting on public endpoints; noted, not done in M0-M3.
- **Jobs:** pg-boss (own `pgboss` schema, admin connection) runs `followups.sweep` and `queue.sweep` every minute and `recall.sweep` daily. Disable with `JOBS_ENABLED=false` (tests/e2e do).
- **Next.js 14, plain CSS, no UI kit:** keeps the screens easy to read and change.
- **Playwright uses installed Google Chrome** (`channel: 'chrome'`), so no browser download.

## Behavioural choices made while building (tell me if any is wrong)

- Queue order is arrival order across one token sequence per clinic per day. Hold keeps your place; skipped/no-show patients rejoin at the back. Only staff can hold/skip/resume; no agent tool can reorder.
- "Called" means in the room until the doctor presses "Patient is here" (`in_consultation`) or Next patient (finishes the previous one). A called patient who has not started after 8 minutes gets one nudge; after 15 minutes the token becomes a no-show and the receptionist is told.
- Estimated wait = patients ahead (including the one in the room) x the clinic's average consult minutes.
- Check-in is idempotent: a patient with an active token today gets the same token again.
- Returning-patient check: the public page learns only "returning yes/no", never a name or id.
- A new patient must consent to storing visit data. WhatsApp messaging and reminders/follow-ups are separate optional consents. Without messaging consent the patient is never messaged proactively (token SMS/WhatsApp, "your turn", reminders, recalls); the receptionist is told when a running-late notice could not be sent.
- A chat from an unknown number is a "lead": info questions are answered, but nothing is stored until they reply YES to consent. Leads are never messaged proactively.
- Running late: the doctor's text creates a pending proposal; **no message is sent and no appointment moves until the doctor confirms** (`confirm_schedule_shift` allows `staff:doctor` only, so no agent can confirm). Appointments whose shifted time would pass the end of their opening window become `needs_rebooking` and the patient is offered the next free slots. Voice notes will arrive as transcripts through the same `/staff/schedule/propose` endpoint once speech-to-text exists.
- Follow-up defaults (per clinic in `clinic_settings.followup_rules`): reminder 24h before, post-visit check-in 24h after the visit, recall after 90 days without a visit or upcoming booking (max one per 30 days). A post-visit reply that says things are not better raises an urgent item; every post-visit reply reaches the team.
- Red-flag matching errs towards escalating (e.g. any newborn + fever, "baby" + high fever). Eval run: 48 messages, all safety rules pass in offline mode.
- Conversation language is sticky once the patient writes in Devanagari; Hinglish (Roman Hindi) keeps the conversation's current language but red-flag and intent rules cover Hinglish.

## Open questions for the owner

1. `docs/sahayak-product-plan.md` was not available when building; everything above follows `KICKOFF.md`. Please add the plan so I can check behaviour against it.
2. Which WhatsApp Business provider and telephony vendor to use (adapters are ready).
3. Doctor-facing configuration (follow-up timings, intake questions, clinic phrases) is stored but has no screen yet. Is that for the pilot or the agent-builder phase?
4. Should a patient with several upcoming appointments be able to cancel all in one message?
