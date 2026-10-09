# Pilot patient feedback HTTPS route

The connected `dr-sharma` clinic uses
`https://shayak.myalgodesk.in/c/dr-sharma/feedback` with a private token in the URL
fragment. Opening the bare address shows an incomplete-link message and no patient
data. Other clinics' pages and staff login/API routes are not exposed by this relay.

## Local services

`scripts/patient-form-relay.py` allows only the clinic's feedback page, Next static
assets, and POST requests to its feedback `open`, `response`, `resolution`, and
`stop` actions. It forwards no browser credentials and logs no request bodies.

Install the two additional login services separately:

```sh
SAHAYAK_SERVICE=patient-web-gateway python3 scripts/install-local-services.py
SAHAYAK_SERVICE=patient-web-tunnel python3 scripts/install-local-services.py
```

The gateway listens on Mac localhost:3001 and forwards permitted requests to the
web app on localhost:3000. The SSH tunnel forwards server localhost:44002 to this
restricted gateway. Existing WhatsApp callbacks use their separate tunnel.

Set `CHECKIN_PUBLIC_WEB_URL=https://shayak.myalgodesk.in` privately in `.env` and
restart the local API. The existing Next rewrite forwards feedback actions to
localhost:4000; public forms do not call the patient's own localhost.

## Server configuration installed for this pilot

- `/opt/agent-platform/patient-form-relay.py`: the same restricted relay.
- `sahayak-patient-form.service`: unprivileged systemd service, listening on private
  Docker host 172.24.0.1:44003 and forwarding to localhost:44002.
- The firewall permits only the existing Caddy container 172.24.0.3 to reach 44003.
- Caddy's `@patientforms` route matches only `shayak.myalgodesk.in`, the feedback
  page, static assets, and the four actions; it proxies to that restricted relay.
- The original proxy configuration was backed up privately, the candidate was
  validated before restart, and existing-site/private-route checks passed.

Keep the Mac awake and both app services, relays and tunnels running for a demo.
This is a Mac-backed pilot address, not independent always-on hosting. Template
approval and real delivery receipts are separate checks; see `demo-showcase.md`.

Route guard tests: `python3 scripts/test_patient_form_relay.py`.

## Approval-aware activation

Migration 050 adds `activation_requested` separately from `enabled` to feedback
and evening-message settings. Staff can review a provider-pending static message
and select **Enable after WhatsApp approval**. This does not approve it at Meta.
Each existing patient-message sweep checks the exact reviewed message and enables
its clinic setting only once provider approval and connection checks succeed.
Concurrent pauses or changed reviews cannot be overwritten. No sending is done by
the activation check itself; regular dispatch retains consent, quiet hours,
provider status/content verification and duplicate/uncertain-send protection.

The connected pilot has both requests armed. Its templates were last reported as
pending utility messages with no rejection reason. Keep the Mac and workers
running; clinic-side settings will then activate without another manual setup
step. Real delivery remains unverified until provider receipts arrive.
