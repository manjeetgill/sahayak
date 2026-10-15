# Sahayak

AI front desk for small clinics in India: one receptionist instead of three or four. See `KICKOFF.md` for the brief and `CLAUDE.md` for conventions.

## Run the demo

**Moving to another laptop or Windows? Start with [Windows setup and laptop transfer](docs/windows-setup.md).**
Finished downloadable videos are included in [demo-media](demo-media/README.md), and the
in-app English videos are available at `/demo/videos` after starting the app.

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

To draft custom agents through the local AI-Agent-Platform, follow [the agent platform integration guide](docs/agent-platform-integration.md).

## Try this

1. Check in on the check-in page, tick consent, get a token. Watch the TV update.
2. Doctor screen: **Next patient**. The patient gets "it's your turn" in the simulator, then intake questions.
3. Simulator: "what are your timings", "book appointment", "मुझे सीने में दर्द है" (red flag: emergency reply, urgent alert on console + doctor screen), "I want to talk to a person".
4. Doctor screen: type "running 30 min late" → **Check impact** → **Confirm and notify patients**.

## Tests

```bash
pnpm test    # 85 tests: row-level security, safety rules, agents, API
pnpm e2e     # Chrome browser journeys in a disposable test database
pnpm eval    # ~50 sample messages (Hindi/English): pass/fail per safety rule
pnpm check      # lint + typecheck + tests
```

### Browser testing

`pnpm e2e` creates and removes its own `sahayak_e2e_*` database using the local
admin connection. It starts separate API/web servers on ports 4100/3100, disables
live messaging and AI providers, and leaves the normal clinic database untouched.
Google Chrome must be installed and the local database must be running. Direct
`playwright test` runs are guarded against resetting a non-test database.

The suite covers check-in, live queues, emergency escalation, clinic setup, FAQs,
API keys, notes, reports, certificates, automation approvals, waiting-list consent
and withdrawal, and care-task review. Live calls, WhatsApp delivery, microphone
recognition, and hosted AI quality need separate provider tests.
