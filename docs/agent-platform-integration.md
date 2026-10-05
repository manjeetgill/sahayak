# AI-Agent-Platform authoring integration

The first integration moves **custom-agent drafting** to AI-Agent-Platform. A doctor still reviews a Sahayak preview and approves activation. Sahayak validates the returned spec and owns execution, patient data, consent, emergency checks, messages, and audit records. Built-in WhatsApp and voice agents still run from Sahayak code; moving their configuration to the platform is a later step.

## Local setup

The platform Docker Compose ports bind to `127.0.0.1` only. Run its API and dependencies from `/Users/manjeet/Desktop/AI-Agent-Platform`:

```sh
docker compose up --build -d postgres redis api
docker compose exec -T api python -m pytest -q tests
```

Put the same random integration key in `SAHAYAK_INTEGRATION_KEY` in the platform `.env` and `AGENT_PLATFORM_KEY` in Sahayak `.env`. Put a model key in the platform's `SAHAYAK_LLM_API_KEY`; keep both `.env` files out of Git. Set `AGENT_PLATFORM_URL=http://127.0.0.1:8000` in Sahayak and restart its API. Run `pnpm db:migrate` with Sahayak's database environment loaded to add platform draft provenance.

## Request path

1. Doctor sends a plain-language request from **Custom agents → Build it**.
2. Sahayak authenticates the doctor and calls `POST /api/integrations/sahayak/drafts` with a clinic ID and the request. It does not send patient lists or records.
3. The platform asks the model for a `sahayak.custom.v1` spec and stores an authoring version. This version is never executable in the platform.
4. Sahayak validates the spec with its own schema and text policy, shows problems or a preview, and requires doctor approval. Any UI edit clears the preview and platform provenance until checked again.
5. Once approved, Sahayak stores a validated snapshot and runs it with its existing consent, time, frequency, tenant, and tool permission checks. An unavailable platform blocks new remote drafts; it does not stop active agents.

If `AGENT_PLATFORM_URL` is absent, Sahayak's previous local draft builder is used. A configured platform error returns a service error rather than silently changing the authoring source.

## Sahayak Agents screen

`/doctor/agents` is the shared entry point for channel configuration status,
clinic workflow switches, and custom automation drafting/review/activation.
Clinic settings retains clinic information and safety controls. Its workflow
switches now link to Agents. Receptionists can see connections and retain their
existing automation pause permissions; only doctors change workflow settings or
approve automations.

`GET /staff/agents/connections` requires a staff session, derives the clinic from
that session, and returns configuration flags and the clinic slug without secrets.
These flags are not provider health checks. Simulators exercise clinic workflows
and store conversations; they do not verify delivery or place calls. Phone and
WhatsApp use shared workflow settings. Platform phone profiles and external action
publishing remain pending; this UI does not claim to support those contracts yet.

### Local usability improvements

- Overview, WhatsApp, Phone, and Automations sections keep drafts mounted when
  switching sections. Saving/checking disables duplicate submissions; a draft ID
  is retained if activation fails so retrying does not create another draft.
- Guided simulations support English/Hindi timing, booking enquiry, handoff,
  emergency, and medical-question scenarios. The authenticated test endpoint
  derives the clinic from the staff session and uses a mock delivery adapter.
  Tests persist clinic conversations and may raise flags or enquiries. They are
  not a rollback sandbox or provider delivery test. Existing public simulator
  endpoints also use mock delivery adapters.
- Diagnostics expose counts and bounded recent queue metadata, omitting contacts, bodies, credentials, and raw vendor errors. Queue acceptance is not a delivery receipt. Live phone diagnostics await platform integration.
- Receptionists can filter conversations needing attention, review a flag's
  conversation even if it is outside the recent list, take over, resolve flags,
  and return a conversation to the agent. Open urgent flags block returning it.
- Automation approval shows timing, current audience count/cap, next scheduled
  run, and the existing rendered message preview. Counts may change before execution.

## Current platform limit

This is the first slice of a shared builder. The platform does not yet manage Sahayak's built-in agent configuration, clinic publishing, or activation status. Its generic task endpoints still have placeholder identity and stub tools, so keep the platform API on loopback until those are replaced. Do not place patient names or records in agent descriptions; those descriptions are sent to NVIDIA for drafting.

## Live channel ownership

Set `LIVE_CHANNEL_OWNER=platform` to disable Sahayak’s direct generic WhatsApp
provider. Both live channels await platform integration; this setting does not
activate delivery. Local simulators remain available. Provider-specific phone
and WhatsApp adapters have been removed, along with their local credentials.
No provider account or AI-Agent-Platform files are changed.
