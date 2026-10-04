# Sahayak

AI front desk for small clinics in India: one receptionist instead of three or four. See `KICKOFF.md` for the brief and `CLAUDE.md` for conventions.

## Run the demo

```bash
cp .env.example .env
pnpm install
docker compose up -d postgres redis
set -a; . ./.env; set +a
pnpm db:reset            # migrate + seed "Dr. Sharma's Clinic" (2 doctors, 25 appointments today)
pnpm dev:api &           # http://localhost:4000
pnpm dev:web             # http://localhost:3000
```

Or everything in containers: `docker compose up --build` (API migrates and seeds on start).

| Screen                                      | URL                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| Patient check-in (QR target, Hindi/English) | http://localhost:3000/c/dr-sharma/checkin                                       |
| Waiting-room TV                             | http://localhost:3000/c/dr-sharma/tv                                            |
| WhatsApp simulator                          | http://localhost:3000/c/dr-sharma/sim                                           |
| Doctor screen                               | http://localhost:3000/login → `anil@demo.sahayak.in` or `meera@demo.sahayak.in` |
| Receptionist console                        | http://localhost:3000/login → `reception@demo.sahayak.in`                       |

Demo password for all staff: `demo1234` (local seed data only). Seeded patients: `9876501000`-`9876501024`.

Without `LLM_API_KEY` the assistant runs on deterministic logic (scripted, works offline). Set `LLM_API_KEY` in `.env` to enable Nemotron 3 Ultra for the second red-flag layer, free-form questions and intake summaries.

## Try this

1. Check in on the check-in page, tick consent, get a token. Watch the TV update.
2. Doctor screen: **Next patient**. The patient gets "it's your turn" in the simulator, then intake questions.
3. Simulator: "what are your timings", "book appointment", "मुझे सीने में दर्द है" (red flag: emergency reply, urgent alert on console + doctor screen), "I want to talk to a person".
4. Doctor screen: type "running 30 min late" → **Check impact** → **Confirm and notify patients**.

## Tests

```bash
pnpm test    # 85 tests: row-level security, safety rules, agents, API
pnpm e2e     # Playwright: new patient journey, running late, red-flag escalation
pnpm eval    # ~50 sample messages (Hindi/English): pass/fail per safety rule
pnpm ci      # lint + typecheck + tests
```
