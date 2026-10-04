# Sahayak: project guide for Claude Code

Sahayak ("helper") is a team of AI agents that runs the front desk of a small clinic or nursing home in India: check-in, live queue, appointments, WhatsApp replies, running-late handling, follow-ups and enquiries. One human receptionist supervises. Full kickoff brief: `KICKOFF.md`. Product plan (source of truth for behaviour): `docs/sahayak-product-plan.md` (**not yet added to the repo; ask the owner before guessing product behaviour**).

## Fixed decisions (do not change without asking)

- Sahayak runs **alongside** the clinic's own software. It has its own appointments, queue and patient contacts. No integration, no changes to their system in release 1.
- **No finance** in release 1: no payments, UPI, invoices, refunds, GST, no payment tables or screens.
- **Hindi and English only.** Every patient-facing string lives in `packages/shared/src/i18n/{en,hi}.json` and is read with `t(lang, key, vars)`. Never hard-code patient-facing text. A test enforces identical keys and placeholders in both files.
- **LLM: NVIDIA Nemotron 3 Ultra** (`nemotron-3-ultra-550b-a55b`) via NVIDIA's hosted OpenAI-compatible API, behind our own `LlmProvider` interface (`packages/agents/src/llm.ts`). Key and base URL come from env (`LLM_API_KEY`, `LLM_BASE_URL`). Never commit keys. With no key the system runs offline on deterministic logic.
- **Agents act only through tools** (`packages/core/src/tools`). An agent never writes to the database directly. Every tool validates input (Zod), checks the actor is allowed, checks the module is enabled for the clinic, runs inside a clinic-scoped transaction, and writes an audit entry. Add new capabilities as tools via `defineTool`, with an explicit `allow` list.
- **Agents never give medical advice.** Red flags always escalate to a human (see Safety).
- **Modular:** agent core + tool layer + modules (`checkin`, `queue`, `appointments`, `followups`, `leads`, `core`). A tool's `module` can be switched off per clinic in `clinic_settings.modules`.
- Channels are adapters (`MessagingChannel`, `VoiceChannel` in `packages/core/src/channels.ts`). Release 1 uses the mock WhatsApp simulator. Do not pick WhatsApp/telephony vendors without asking.
- Real WhatsApp, voice and the agent builder have been started (see `docs/decisions.md`, Post-pilot features). WhatsApp/telephony/STT/TTS **vendors are still unchosen**: build only behind the adapter interfaces and ask before picking one.

## Safety rules (enforced in code, tested)

1. Red-flag detection runs on every patient message before any agent replies. Layer 1: deterministic Hindi/Hinglish/English phrases and proximity patterns (`packages/shared/src/redflags.ts`) plus clinic-added phrases. Layer 2: LLM classifier. Either triggers.
2. On a red flag: fixed emergency message (go to ER / call 108), urgent alert on the console and doctor screen, audit entry. Clinics can add phrases, never remove the built-ins (they live in code).
3. Medical questions get the fixed reply `msg.medical_advice`.
4. "Talk to a person" or an upset patient goes to the receptionist (conversation `handled_by='human'`; agents go silent).
5. Fail safe: if the LLM is down or slow, check-in and queue keep working as plain software; the console shows a banner (`llm_status` event).
6. Everything is audited in `agent_actions` (append-only for the app role).
7. DPDP: consent recorded at check-in (purpose-specific, versioned), minimal data, per-clinic row-level security, no patient data in logs sent to third parties. Proactive messages need messaging consent.
   Tests that must stay green: `packages/agents/test/safety.test.ts`, `packages/db/test/rls.test.ts`, `pnpm eval`.

## Privacy and integrations rules (also enforced and tested)

- Personal data must not end up in the audit log: use `auditOutput` on a tool whose result holds it. Erasure/retention redact via the security-definer functions in `005_privacy.sql`.
- Outbound events go through `emitWebhook` inside the tool transaction; keep payloads to ids unless it is a "full" webhook. API keys never see another clinic and are scope-limited in `callTool`.
- New patient-facing flows need Hindi and English strings, and STOP/consent must keep working.

## Commands

```
pnpm install
docker compose up -d postgres redis      # local infra (Postgres :55450, Redis :56379)
pnpm db:reset                            # drop, migrate, seed demo clinic (needs env, see below)
pnpm dev:api                             # API on :4000
pnpm dev:web                             # screens on :3000
pnpm test                                # unit + integration (needs Postgres up)
pnpm e2e                                 # Playwright (uses installed Google Chrome; resets demo data)
pnpm eval                                # ~50 Hindi/English messages, pass/fail per safety rule
pnpm check                                  # lint + typecheck + tests
docker compose up --build                # everything in containers (api migrates + seeds on start)
```

Load env first when running scripts by hand: `set -a; . ./.env; set +a`. Copy `.env.example` to `.env`.
Note: this machine's global `~/.npmrc` has a broken registry; the repo-level `.npmrc` overrides it.

## Layout

- `packages/shared` Zod schemas, i18n, red-flag lists, live-event types.
- `packages/db` SQL migrations (`migrations/`), migrate/seed/reset, `withClinic` (sets `app.clinic_id` for RLS), test helpers.
- `packages/core` EventBus (Redis pub/sub with in-process fallback), tool registry and all tools, channel interfaces.
- `packages/agents` `LlmProvider` + Nemotron client + `LlmGate` (health), safety checks, intent rules, orchestrator, agents (front desk, leads, queue, intake, schedule, follow-up), pg-boss jobs, eval.
- `apps/api` Fastify REST + WebSocket. `apps/web` Next.js screens. `e2e/` Playwright.

## Conventions

- TypeScript everywhere, ESM. Prettier (`pnpm format`), ESLint (`pnpm lint`).
- Every tenant table has `clinic_id` and RLS (`ENABLE` + `FORCE`). The app connects as non-superuser `sahayak_app`. Always go through `withClinic` or `callTool`. New tenant tables: copy the policy loop from the migrations; the RLS test fails if one is missing.
- Staff emails are stored lowercase.
- Technical decisions go in `docs/decisions.md`. Product decisions the plan doesn't cover: ask the owner.
- Commit in small steps; never commit real patient data, keys or secrets.
