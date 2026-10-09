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
- Admin can now review clinic-scoped care screens and patient updates through an explicit read-only endpoint/tool allow-list. Patient-care mutations, payment confirmation and clinical signatures still require the appropriate care staff login.
- Doctors can update their own registration and qualifications. Admin cannot sign clinical documents or supply a doctor’s signing credentials through this screen.
- Existing doctor and receptionist accounts are unchanged. New clinic signup creates an Admin account; the Admin then creates doctor and receptionist logins.
- Creating a doctor login requires an active doctor profile in the same clinic. Setup completion requires a doctor login. A receptionist login is optional in the single-doctor view.
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

- Role tests cover setup access, clinic-scoped care review and clinical-write denial for Admin, care-staff denial for setup, cross-clinic doctor linking, own-profile restrictions, tool-level authorization, audit redaction, and removed-account tokens.
- Signup and feedback tests cover the Admin setup flow alongside doctor/receptionist workflows.
- Browser checks use only the isolated synthetic demo clinic. No provider activation or patient message is required for these checks.

### Doctor-controlled feedback scheduling

Doctors can now change **Patient check-ins → Automatic check-ins** at any time. These preferences control automatic scheduling when their visits finish. Admin controls actual WhatsApp delivery separately under **Patient check-in messages**. Migration `029_automatic_visit_feedback.sql` stores the doctor-owned preferences. The synthetic demo doctor is enabled for next-day 18:00 check-ins; its live invitations remain paused.

## QR arrivals and payment confirmation

Admin → Payments & QR (`/admin/qr-checkin`) enables the flow, sets the consultation fee and saves the address patients can open. Reception → Arrivals & payments (`/console/arrivals`) shows the submitted patient details and payment confirmation controls. The printable poster is `/c/:slug/poster`; when enabled, its QR opens `/c/:slug/arrival`.

1. Patient scans, selects a doctor and enters name/phone, with visit-data permission. WhatsApp and follow-up permissions are optional.
2. Sahayak records a pending arrival with the fee at submission time. It does not issue a queue token yet.
3. Reception checks the money received outside Sahayak, selects cash/UPI/card/bank/other and explicitly confirms receipt.
4. One database transaction records the charge and payment, checks for an existing active visit and issues the doctor queue token. Repeated/concurrent confirmation cannot create another payment or token.
5. The doctor's existing queue updates. The patient's private status page refreshes every ten seconds; reception uses live events with a fifteen-second refresh fallback.
6. Calling the patient and finishing the visit updates the private page. Existing automatic feedback preferences apply when the doctor finishes, with patient permissions and delivery settings still required.

This version **records money already received**. It does not initiate an online payment or verify a UPI transfer. Automatic online confirmation requires a payment-provider integration with verified server callbacks. Existing staff walk-in and WhatsApp check-in paths remain separate.

Private receipt links use random 256-bit tokens, stored only as hashes, expire after twelve hours, and omit patient name/phone. Public submitters cannot confirm payment or choose its amount. Clinic isolation, staff roles, erasure, cancellation, expired arrivals, fee changes and duplicate confirmations are covered by integration tests.

For local phone testing, use the Mac's Wi-Fi address instead of localhost. Both web (3000) and API (4000) must be reachable on that network. A Wi-Fi address can change; update the setting and reprint the poster when it does. For public use, deploy web/API behind HTTPS and configure the web app's API address accordingly.

## Online payment setup (Razorpay)

Admin → Payments & QR now includes **Online payments — Razorpay** and payment activity. This extends the receptionist-confirmed flow above; no account is connected or enabled automatically.

1. In the clinic Razorpay account, generate **test keys**. Put the clinic UUID, `keyId`, `keySecret` and a separately chosen `webhookSecret` into the private `RAZORPAY_CLINIC_CREDENTIALS` JSON environment setting. The admin payment panel shows the clinic UUID in the webhook path. The example file contains the structure; do not paste real keys into chat or Git.
2. Restart the API and save the QR clinic fee (minimum ₹1 for online payment). Enable automatic capture in Razorpay. Configure a public HTTPS API webhook at `/integrations/razorpay/CLINIC_UUID`, subscribing to `payment.captured`, `order.paid`, and `refund.processed`, using the matching webhook secret.
3. Admin reviews the mode/account and explicitly enables checkout. Patients can choose Razorpay on their private arrival page. No patient name, phone, visit text or medical information is prefilled or included in the provider order.
4. Sahayak creates the order with its own saved fee. Checkout success alone is insufficient: the server checks the signature against its saved order ID, retrieves payment state from Razorpay, and requires matching order, INR amount and captured status. The signed webhook does the same even if the browser closes. Duplicate browser/webhook requests cannot double-record payment or issue another token.
5. **Check payment status** (patient) or **Check provider status** (admin) recovers a missed callback without another charge. If order creation times out, its receipt is fenced; admin locates the receipt in Razorpay and uses **Verify and link this order**. Uncertain orders are never automatically recreated.
6. Test payments are labelled and excluded from real collection totals. Use synthetic patients/a demo clinic: test checkout still creates a test visit and token so the queue can be demonstrated. Once verified in Razorpay test mode, replace the keys with live keys, use a public HTTPS patient address, check the live webhook configuration, and explicitly enable checkout for live use. Keep the original account keys available until its pending orders are resolved; the app rejects account changes for an existing order.

Cancelled/expired arrivals, inactive doctors, changed visit ownership and refunds go to staff review. A captured payment is retained even when a visit cannot be queued. Refund events flag review; staff must reconcile the ledger and arrange any refund in Razorpay. Sahayak does not initiate refunds. An online order blocks manual payment confirmation for that arrival so a pending checkout cannot become a duplicate cash/UPI payment. Patient erasure removes the arrival link; provider references are retained as financial records.

Reference contracts: [Razorpay Standard Checkout](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/), [webhook verification](https://razorpay.com/docs/webhooks/validate-test/), [Orders API](https://razorpay.com/docs/api/orders/create/).

Validation in this repository uses mocked Razorpay responses plus real local database transactions. Real test-mode checkout and real money delivery remain unverified until the owner supplies keys and completes the account/webhook setup.

### Doctor-controlled assistants

Admin → Assistants → Everyday help now has separate permissions for each active doctor: WhatsApp, phone, and personal reminders. Granting access starts the personal assistant paused; the doctor opts in under Doctor → My assistants. Revoking access disables the doctor's preference, pauses their active personal reminders, and cancels pending runs. Regranting does not restart them automatically.

Doctors can draft, preview, edit, activate, pause, resume, delete, and review runs for their own reminders. Ownership comes from their signed-in doctor profile, never a submitted doctor ID. Audiences and visit/appointment triggers are scoped to that doctor; personal summaries and staff notifications go only to that doctor. Clinic-wide metrics and reception notifications remain Admin tasks. Existing consent, quiet hours, message limits, medical-content restrictions, and the clinic active-task cap still apply.

WhatsApp and phone preferences govern Sahayak conversation handling once a doctor is linked or selected. A paused assistant hands the conversation to reception; safety and privacy checks still run. Unassigned clinic enquiries continue on the shared number. Phone provider settings, live test-call controls, credentials, and shared channel activation remain Admin-only. This does not add live phone service or change AI-Agent-Platform.

Migration 034 preserves existing clinic-managed service where no individual rule exists. Admin can explicitly disable it for a doctor or grant personal control. Existing clinic-wide reminder tasks and patient check-in campaigns are separate from personal reminders and retain their existing settings. Run database migrations before deploying the API update.

## Full Admin visibility

`/admin/features` lists built features and links to setup, payment, assistant, care, reception, safety and public patient screens. Patient links use the signed-in clinic’s slug. Admin settings default to Show all settings; assistants default to Show everything, including WhatsApp/phone setup and reminders. Connection and technical details are expanded.

Admin can open doctor/reception screens in review mode, see patient records and clinic work, and read every doctor’s saved feedback scheduling preferences. Review does not impersonate a doctor. The API and tool registry use explicit read allow-lists; signing notes/documents, confirming cash receipts, editing clinical work and deleting patient data remain care-staff actions. Admin setup/connection permissions are unchanged. The review banner explains the distinction, and role/clinic-isolation tests cover it.

Online payment setup is at `/admin/qr-checkin#online-payments`, with visible links in the Admin sidebar and homepage. Having the screen available does not enable Razorpay or confirm live payment readiness.
## Clinic views

Admin can choose **Single doctor** or **Clinic or small hospital** on the Admin home screen. The choice is saved for the clinic and can be changed at any time. Single doctor shows a focused doctor Today screen with walk-in check-in, QR arrivals and payments, patient messages, follow-up work, and assistant controls. A doctor may check a walk-in into only their own queue in this mode. The clinic view does not activate live WhatsApp, phone, or Razorpay connections; those have their own setup.

The clinic owner is selected from active doctor logins on the Admin home screen. That doctor keeps the doctor role and signing identity while also gaining Admin and front desk access. Permission is checked against the current owner assignment on each request, so removing the assignment revokes access even for an existing session. The owner sees Clinic setup and All features from the doctor navigation. A separate Admin account can still manage the clinic.

### Solo doctor daily flow

- **Needs me** on Today is the existing source-linked doctor inbox, now including uncertain or review-needed online payments. Urgent alerts stay visible. The list links back to the patient record, conversation, payment review, or care task; it does not mark work complete merely because the doctor opened it.
- The owner can set **Available**, **Seeing patients**, or **Closed for now** on Today. This is a work signal, not a public-hours change or an automatic channel switch. Routine assistant conversations continue only if their channels are actually connected and enabled. Human handoffs in a solo clinic are assigned to the owner; the wording shown to patients does not promise an immediate answer or a receptionist.
- **Private patient link:** From a consenting patient's record the doctor can create a seven-day link. Creating a new one revokes older links. The URL token is random, stored only as a hash, carried in the URL fragment, and sent to the API in POST bodies. The holder can see only that patient's future appointments, queue and QR payment status; book, change, or cancel a future appointment; upload a report; and reply to an active doctor-approved care-plan step. A public clinic page does not expose a patient record. A clinic must provide a public HTTPS address before sharing this link outside the local network.
- A patient-uploaded report can be attached to one requested report task. The upload and transition to **Received** occur together. The doctor still reviews the file and records when the patient is informed. The patient page clearly says that upload is not clinical review.
- **Close day** counts open queue entries, urgent alerts, unanswered messages, unsigned drafts, payment problems, care tasks due, and tomorrow's bookings. The doctor can record that they reviewed these counts; unfinished items remain open.
- The patient record has a short **personal follow-up plan** form. The doctor writes the wording, saves a draft, and explicitly approves it. Approved steps appear in the work list; patient replies through their private link return for doctor review. Emergency keyword matches raise an urgent alert, but keyword checks are not comprehensive triage. Automatic outbound delivery of these bespoke messages is not enabled: live WhatsApp still needs a provider connection and approved templates, and the doctor records any contact made outside the app.
