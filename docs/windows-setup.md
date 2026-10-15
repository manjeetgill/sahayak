# Move Sahayak from Mac to Windows

## What GitHub includes

- Application code, migrations, demo seed data, tests and video-making scripts.
- Solo doctor and clinic/hospital demos, with doctor, admin and reception views.
- Finished videos in `demo-media/` and the in-app recordings in `apps/web/public/demo-videos/`.
- The updated English videos with three-second pauses. Play MP4 files directly without running Sahayak.

GitHub does **not** contain your `.env` credentials, current clinic database, browser sessions, Docker volumes, or the separate AI-Agent-Platform repository/runtime. Fresh demo data can be recreated; your current clinic records and live connection settings require a private database transfer.

## 1. Install on Windows

Install Git for Windows, Node.js **22 LTS**, Docker Desktop (with its WSL 2 backend), and Google Chrome. Restart Windows if Docker requests it. Open Docker Desktop and wait until it is running. Use PowerShell for the commands below.

```powershell
node --version
npm.cmd install --global pnpm@9.15.9
git clone https://github.com/manjeetgill/sahayak.git
cd sahayak
pnpm.cmd install --frozen-lockfile
Copy-Item .env.example .env
notepad .env
```

Use `pnpm.cmd` if PowerShell blocks `pnpm.ps1` under its execution policy; no policy change is necessary. Keep the repo in a normal local folder such as `C:\Projects\sahayak`, outside OneDrive. Do not run the Mac `launchctl` installer on Windows.

For a safe initial local demo, set these values in `.env`:

```dotenv
LLM_PROVIDER=offline
JOBS_ENABLED=false
PATIENT_MESSAGES_JOBS_ENABLED=false
NEXT_PUBLIC_API_URL=http://localhost:4000
```

Keep the database and Redis URLs from `.env.example`: PostgreSQL uses port **55450**, Redis **56379**. Keep keys blank for practice. If restoring your private `.env`, update any Mac file paths and localhost services as described below.

Create the frontend setting (Next.js reads this file separately):

```powershell
Set-Content apps/web/.env.local 'NEXT_PUBLIC_API_URL=http://localhost:4000'
```

## 2. Start the local demo

```powershell
pnpm.cmd demo:ready
```

This starts PostgreSQL/Redis, applies migrations, seeds the fictional solo and hospital clinics, starts API/web services and checks the demo logins. It does not reset an existing clinic. Run it again after restarting the laptop. Keep Docker Desktop running.

Open:

- Home: http://localhost:3000/
- Choose solo doctor or clinic/hospital: http://localhost:3000/demo
- Guided moving patient journey: http://localhost:3000/demo/present
- Recorded English videos: http://localhost:3000/demo/videos
- Login: http://localhost:3000/login

Demo logins (fictional data only), password **demo1234**:

| Role | Email |
| --- | --- |
| Solo doctor with clinic management | doctor@solo.demo.test |
| Hospital doctor | kavita@hospital.demo.test |
| Hospital admin | admin@hospital.demo.test |
| Hospital reception | desk@hospital.demo.test |

Select the clinic view at `/demo`. Both modes have seeded examples. Use `pnpm.cmd demo:ready --refresh-demo` only to replace the fictional showcase clinic data with a fresh demo. Do not use `db:reset` on a database you want to keep.

### If a server does not start

Logs are `%TEMP%\sahayak-demo-api.log` and `%TEMP%\sahayak-demo-web.log`. Check Docker first, then check that ports 3000 and 4000 are free. To run in visible terminals:

```powershell
# Terminal 1, in the repo
pnpm.cmd dev:api
# Terminal 2, in the repo
pnpm.cmd dev:web
```

Stop the existing Sahayak Node processes before starting duplicate servers. Closing a background-started terminal may stop its children on some Windows setups; the two visible terminals are the fallback. The helper is designed for Windows, but was verified on Mac, not on a Windows machine.

## 3. Preserve your existing Mac data before retiring it

Transfer these **privately** using an encrypted drive or password manager; never add them to GitHub:

1. Repository-root `.env` (keys, connection secrets, model settings).
2. `apps/web/.env.local` (replace local API setting as above on Windows).
3. A PostgreSQL backup of the current Sahayak database. Records, uploaded document bytes, clinic settings and connections are stored there.
4. The separate AI-Agent-Platform repository, its private environment/configuration and its own database/storage backup, if you still run it on this Mac. Sahayak's clone does not contain that service.
5. Any media render intermediates you want to edit later under `artifacts/`. Finished viewing/sharing videos are already committed. Older video builders use macOS `say`; playback on Windows does not require rebuilding them.

For the default local Docker database, create a backup on the Mac:

```sh
mkdir -p private-transfer
cp .env private-transfer/sahayak.env
cp apps/web/.env.local private-transfer/web.env.local
docker compose exec -T postgres pg_dump -U postgres -d sahayak -Fc -f /tmp/sahayak-transfer.dump
docker compose cp postgres:/tmp/sahayak-transfer.dump private-transfer/sahayak.dump
docker compose exec -T postgres rm /tmp/sahayak-transfer.dump
```

`private-transfer/` and `*.dump` are ignored by Git. These files may contain sensitive clinic records and credentials. Copy that folder securely to Windows before wiping the Mac. If your database is not the default Docker `sahayak` database, back up the database identified by your private `ADMIN_DATABASE_URL` instead.

### Restore on Windows (only into your new local database)

Copy the private folder into the new repo. Set up the app once as above, then stop its API/web processes. The following restore **replaces the new local database contents**. Do not run it against an existing clinic you need to retain.

```powershell
docker compose up -d postgres redis
# Migrate first so the application's PostgreSQL role exists.
node --env-file=.env node_modules/tsx/dist/cli.mjs packages/db/src/migrate.ts
docker compose cp private-transfer/sahayak.dump postgres:/tmp/sahayak-transfer.dump
docker compose exec -T postgres pg_restore -U postgres -d sahayak --clean --if-exists --no-owner --exit-on-error /tmp/sahayak-transfer.dump
docker compose exec -T postgres rm /tmp/sahayak-transfer.dump
```

Privately merge your saved `.env` into the new `.env`. Preserve encryption keys (especially `GOOGLE_CONNECTION_ENCRYPTION_KEY`) and matching callback secrets; changing them can break stored connections. Keep background jobs off during transfer. Start with `pnpm.cmd demo:ready`; migrations will catch up and existing showcase data will be preserved.

Verify appointments, records, feedback and clinic settings before retiring the Mac. A restored database also retains the old staff credentials; the fresh demo accounts are only for the seeded fictional clinics.

## 4. Restore real AI, WhatsApp, calls and payments

The offline demos work without provider accounts. Live services need your privately transferred settings:

- **AI:** select `LLM_PROVIDER=together` (or the intended provider), restore its key, and run `pnpm.cmd check:model` after starting the app with that configuration.
- **Agent platform:** start the separate platform on Windows or point Sahayak to its hosted URL. `127.0.0.1` means the new laptop, not the old Mac. Restore matching bindings and callback secrets on both services.
- **WhatsApp/calls:** restore the platform connection and configure a reachable HTTPS webhook/tunnel on the new laptop. Update the registered callback/public URLs when the address changes. Recheck the connection in Admin and test with your own number before enabling sending.
- **Feedback links:** update `CHECKIN_PUBLIC_WEB_URL` and the public web/API URLs to the new HTTPS addresses. Approved templates and patient consent still apply.
- **Google:** preserve the encryption key and update authorized redirect URLs if the address changes.
- **Razorpay:** restore keys/webhook secret privately and update the provider webhook to the new public API URL. Test-mode verification comes before live payments.

Enable scheduled jobs deliberately after verifying the new connections, and stop the old Mac services to avoid having two installations processing live work. A Git clone alone cannot reconnect these external services.

## 5. Check and update

```powershell
pnpm.cmd typecheck
pnpm.cmd demo:check
```

The browser demo check uses installed Google Chrome. It exercises fictional data. For later code updates:

```powershell
git pull --ff-only origin main
pnpm.cmd install --frozen-lockfile
pnpm.cmd demo:ready
```

Stop and restart the local servers after updates. Keep `.env` and the private database backup secure; they are intentionally never published with the application.
