# Direct Google connections

Sahayak can send appointment updates directly to Google Calendar and Google Sheets. n8n and AI-Agent-Platform are not required. Other clinic products still need their own supported API adapter; this does not turn every software product into a ready-made connection.

## Admin flow

Open **Admin → Connections** (`/admin/integrations`).

1. Read the information-sharing explanation and tick the acknowledgment.
2. Choose **Connect Google Calendar** or **Connect Google Sheets**. Sign in to the clinic’s Google account and review Google’s requested access.
3. Return in the same browser tab and Sahayak Admin account. Sahayak completes sign-in but does not start exports.
4. Create the dedicated clinic calendar or spreadsheet.
5. Confirm sharing and choose **Turn on automatic updates**. Optionally include existing booked/checked-in appointments in the next 90 days.
6. Book or change an appointment in Sahayak. The background worker checks due updates every 30 seconds while the API is running. Backlogs and provider retries can take longer.
7. Use **Refresh status** to see waiting, failed and up-to-date counts. **Check connection** verifies Google access; a successful appointment update is separate evidence.
8. Pause, retry or disconnect from the same card.

Doctors and receptionists continue using their usual appointment screens. Connection management is Admin-only and clinic-scoped.

## Exactly what is shared

- Opaque appointment reference and doctor reference.
- Appointment start/end timestamps and status.
- Calendar: a generic title, references, times and status. No guests are invited and event reminders are disabled. The calendar name includes the clinic reference prefix.
- Spreadsheet: one stable row per appointment, five columns, timestamps in UTC. It has capacity for 9,999 appointments plus a header.

No patient name, patient phone, medical note, intake response, report or prescription is exported. References and appointment times should still be treated as clinic information.

The sync is **one way: Sahayak → Google**. Calendar events reflect bookings/time changes and are removed for cancelled/deleted appointments. Rebooking-needed appointments remain with that status in the description until changed in Sahayak. Sheet rows retain the latest status, including cancellation/deletion. This is a current appointment register, not a full change-history export. Keep the managed Appointments tab and row order unchanged; use a separate tab for analysis. Manual sorting or moving rows can stop affected updates rather than overwrite another appointment.

## One-time setup for the development/hosting team

1. Create/select the clinic software’s Google Cloud project.
2. Enable the Google Calendar API and Google Sheets API.
3. Configure the OAuth consent screen/audience and appropriate test users while testing. Google may require verification before broader release, depending on the project’s audience and requested access.
4. Create an OAuth **Web application** client. Add the exact redirect URI below to its allowed redirect URIs.
5. Set these variables privately in the API server environment (`.env` locally):

```dotenv
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_CONNECTION_ENCRYPTION_KEY=64-hexadecimal-characters
GOOGLE_REDIRECT_URI=http://localhost:4000/integrations/google/callback
GOOGLE_APP_WEB_URL=http://localhost:3000
```

Generate the encryption key with `openssl rand -hex 32`. Keep it private and stable across restarts; back it up with the deployment secrets. Losing or replacing it makes saved credentials unreadable, requiring reconnection. Do not put credentials in the browser environment or commit them.

For hosting, replace the two localhost URLs with HTTPS addresses for the API callback and web origin. The web value must be an origin with no extra path, query or fragment. The API callback path must stay `/integrations/google/callback`. Configure the web app’s existing `NEXT_PUBLIC_API_URL` to reach that API.

6. Apply database migrations (`pnpm db:migrate` with the existing database environment loaded) and restart the API. Keep `JOBS_ENABLED` enabled; the API process must remain running for scheduled exports.
7. Follow the Admin flow using made-up appointments, verify Google entries and the Sahayak delivery counts, then test rescheduling, cancellation and pause/resume before using it for clinic work.

The requested scopes are `calendar.app.created` for a Sahayak-created secondary calendar and `drive.file` for the Sahayak-created spreadsheet. The application never asks to browse all personal calendars or all Drive files. Google OAuth testing/organization policies may limit token lifetime or permitted accounts; if Google revokes access, reconnect through Sahayak.

## Reliability and access controls

- OAuth uses signed, expiring, single-use state plus PKCE. Completion also requires the initiating Admin login and a separate browser-held proof. Sharing an authorization URL alone cannot silently activate a connection.
- Refresh tokens and PKCE verifiers are encrypted with AES-256-GCM and bound to their clinic/purpose. Tokens are not returned by the status API. Callback URLs are redacted from Fastify request logs; configure reverse-proxy access logs to omit callback query strings too.
- Appointment updates enter the database queue in the appointment transaction. Rolled-back bookings do not export. The queue coalesces changes to the latest appointment state.
- Deterministic calendar event IDs and fixed spreadsheet row numbers make repeated attempts safe against duplicate entries. HTTP redirects are rejected; calls have timeouts and fixed Google destinations.
- Transient write failures retry up to five attempts with increasing delay. Authentication failures pause delivery and request reconnection. Retry waiting updates resets failed/pending items for another attempt.
- Delivery serializes per connection. New, unrelated bookings can proceed while a Google request is outstanding; a simultaneous change to the exact appointment currently being delivered may wait for that delivery transaction.
- An uncertain destination creation is not automatically retried. If a response is lost or setup crashes, check Google before disconnecting and starting again; the calendar/sheet may already exist.
- Pause keeps pending changes. Disconnect deletes Sahayak’s saved credentials and queue. Previously copied Google data remains. Disconnect does not revoke the app’s Google account grant; the account owner can remove that separately in Google account permissions. Removing the shared app grant may also affect the other Google connection.
- Google files/events are not automatically purged by Sahayak patient-data deletion. Calendar appointment deletion removes its entry; Sheets retains only the exported references/status. Account owners manage retained Google exports.

## Verification status

Automated tests use an isolated clinic database and a mock Google service. They exercise authorization, expiry/replay, cross-clinic denial, encrypted credentials, explicit sharing, uncertain setup, transaction rollback, duplicate-safe retries, row-edit protection, pause/resume, backfill, disconnect and concurrent bookings. This is **not evidence of live Google delivery**. Live testing requires the configured Google project and an Admin’s Google authorization.

## Official provider references

- [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Calendar authorization scopes](https://developers.google.com/workspace/calendar/api/auth)
- [Calendar creation](https://developers.google.com/workspace/calendar/api/v3/reference/calendars/insert)
- [Calendar event IDs](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)
- [Sheets authorization scopes](https://developers.google.com/workspace/sheets/api/scopes)
