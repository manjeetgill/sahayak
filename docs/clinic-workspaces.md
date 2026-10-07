# Three clinic workspaces

## Roles

| Workspace    | Home       | Responsibilities                                                                                                                                     |
| ------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin        | `/admin`   | Clinic setup, opening hours, doctors and logins, assistants, WhatsApp/phone connections, integrations and check-in message delivery settings.        |
| Doctor       | `/doctor`  | Consultations, patient records, notes and signed documents, clinical follow-up, feedback and clinic improvement tasks. Own professional credentials. |
| Receptionist | `/console` | Appointments, queue, patient conversations, waiting list, callbacks, feedback follow-through and privacy requests.                                   |

Sign in at `/login`. The account’s role determines its home and navigation. There is no role picker that grants access. Separate accounts are required if one person also performs another role.

## Access boundaries

- Setup mutations and team management require Admin at both the API and tool layer.
- Admin is excluded from clinical HTTP endpoints and the patient-update WebSocket. Administrators can configure connections that handle patient data; this is a trusted setup role, not a guarantee that an administrator with integration credentials cannot access exported data.
- Doctors can update their own registration and qualifications. Admin cannot sign clinical documents or supply a doctor’s signing credentials through this screen.
- Existing doctor and receptionist accounts are unchanged. New clinic signup creates an Admin account; the Admin then creates doctor and receptionist logins.
- Creating a doctor login requires an active doctor profile in the same clinic. Setup completion requires a doctor login and receptionist login.
- HTTP requests validate the current account, role, and doctor link; removed accounts cannot continue using an old token for subsequent requests. WebSocket connections validate accounts on connection.
- Passwords are excluded from account-creation audit entries, including rejected calls.
- Feedback work can only be assigned to patient-care staff.

## Local synthetic demo

All three logins belong to the **Patient Care Demo Clinic**, separate from other clinics:

| Role         | Email                                | Local demo password |
| ------------ | ------------------------------------ | ------------------- |
| Admin        | `feedback.admin@demo.sahayak.in`     | `demo1234`          |
| Doctor       | `feedback@demo.sahayak.in`           | `demo1234`          |
| Receptionist | `feedback.reception@demo.sahayak.in` | `demo1234`          |

Create missing demo accounts/data with:

```sh
node --env-file=.env --import tsx scripts/seed-feedback-demo.ts --create
```

This refuses production mode, preserves existing demo data and leaves live feedback messaging paused.

## Existing clinics

Apply migration `028_admin_workspace.sql`. Existing accounts are not promoted. A server operator can create a separate Admin login with:

```sh
# In zsh: read a new password privately; do not put it in command history.
read -s 'SAHAYAK_ADMIN_PASSWORD?New admin password (12+ characters): '
export SAHAYAK_ADMIN_PASSWORD
node --env-file=.env --import tsx scripts/create-clinic-admin.ts --clinic CLINIC_SLUG --email ADMIN_EMAIL --name 'Clinic Admin'
unset SAHAYAK_ADMIN_PASSWORD
```

The helper requires server database credentials, refuses a reused email, and does not reset or change an existing account.

## Verification

- Role tests cover setup access, clinical denial for Admin, care-staff denial for setup, cross-clinic doctor linking, own-profile restrictions, tool-level authorization, audit redaction, and removed-account tokens.
- Signup and feedback tests cover the Admin setup flow alongside doctor/receptionist workflows.
- Browser checks use only the isolated synthetic demo clinic. No provider activation or patient message is required for these checks.

### Doctor-controlled feedback scheduling

Doctors can now change **Patient check-ins → Automatic check-ins** at any time. These preferences control automatic scheduling when their visits finish. Admin controls actual WhatsApp delivery separately under **Patient check-in messages**. Migration `029_automatic_visit_feedback.sql` stores the doctor-owned preferences. The synthetic demo doctor is enabled for next-day 18:00 check-ins; its live invitations remain paused.

## QR arrivals and payment confirmation

Admin → Patient check-in QR (`/admin/qr-checkin`) enables the flow, sets the consultation fee and saves the address patients can open. Reception → QR arrivals (`/console/arrivals`) shows the submitted patient details and payment confirmation controls. The printable poster is `/c/:slug/poster`; when enabled, its QR opens `/c/:slug/arrival`.

1. Patient scans, selects a doctor and enters name/phone, with visit-data permission. WhatsApp and follow-up permissions are optional.
2. Sahayak records a pending arrival with the fee at submission time. It does not issue a queue token yet.
3. Reception checks the money received outside Sahayak, selects cash/UPI/card/bank/other and explicitly confirms receipt.
4. One database transaction records the charge and payment, checks for an existing active visit and issues the doctor queue token. Repeated/concurrent confirmation cannot create another payment or token.
5. The doctor's existing queue updates. The patient's private status page refreshes every ten seconds; reception uses live events with a fifteen-second refresh fallback.
6. Calling the patient and finishing the visit updates the private page. Existing automatic feedback preferences apply when the doctor finishes, with patient permissions and delivery settings still required.

This version **records money already received**. It does not initiate an online payment or verify a UPI transfer. Automatic online confirmation requires a payment-provider integration with verified server callbacks. Existing staff walk-in and WhatsApp check-in paths remain separate.

Private receipt links use random 256-bit tokens, stored only as hashes, expire after twelve hours, and omit patient name/phone. Public submitters cannot confirm payment or choose its amount. Clinic isolation, staff roles, erasure, cancellation, expired arrivals, fee changes and duplicate confirmations are covered by integration tests.

For local phone testing, use the Mac's Wi-Fi address instead of localhost. Both web (3000) and API (4000) must be reachable on that network. A Wi-Fi address can change; update the setting and reprint the poster when it does. For public use, deploy web/API behind HTTPS and configure the web app's API address accordingly.
