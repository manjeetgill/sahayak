# Patient check-in demo

This demo uses a separate synthetic clinic. No actual patient messages are sent.

## Open

- URL: http://localhost:3000/login
- Doctor email: `feedback@demo.sahayak.in`
- Reception email: `feedback.reception@demo.sahayak.in`
- Local demo password for both: `demo1234`
- Main screen after sign-in: http://localhost:3000/doctor/checkins

If the browser autofills another email, replace it before signing in. These are local demonstration accounts only.

## Five-minute walkthrough

1. **Show the problem:** open Demo patient — Asha. The patient reports no improvement and unclear instructions. Show their original words and the linked patient record.
2. **Show the work:** record patient contact, then the clinic action. Choose an owner and a next review time when needed. These actions are records of human work, not calls/messages being made automatically.
3. **Show the assistant:** click Prepare reading assistance. The result shows exact patient excerpts and a suggested category. It is labelled as AI assistance when the configured model succeeds, otherwise as staff review. No treatment advice is generated.
4. **Close the loop:** prepare a resolution link, open the private form, and answer “I still need help.” Refresh the clinic screen to show that the concern reopens. After another recorded contact and action, a new confirmation can close it with “Yes.”
5. **Improve the clinic:** open Clinic improvements, review the explanation/waiting themes, follow the links to originals, and create an owned improvement task with a review date.
6. **Reception:** sign in as the demo receptionist and open Patient check-ins. Show callback ownership and contact history. Clinical action/closure stays with the doctor.

## Show a new patient response

Open **Demo patient — New check-in** in the patient responses list. It has an untouched scheduled check-in: prepare its patient form link, open it in another tab and submit a response during the meeting.

Demo patient — Meera has a visit linked to a Hindi check-in. The browser verification already submitted a synthetic callback response and reopened it after an unresolved confirmation. Use Asha/Ravi for another resolution demonstration, or schedule a check-in for a new synthetic patient through the usual visit flow.

To demonstrate scheduling, open an active visit → Review and finish visit → choose date, owner, language and patient agreement → Schedule check-in. Then Care → Patient check-ins → Review check-in → Prepare patient form link. Open that link in another tab to play the patient. It expires after seven days.

## Explain WhatsApp accurately

Open WhatsApp messages to show the live connection/readiness status. Outbound sending is paused for the synthetic clinic. A real launch needs an approved invitation template supported by the platform and a public HTTPS web/API deployment. Do not describe an opened form or prepared link as a delivered WhatsApp message.

## Re-create on another local development database

Run migrations first, then:

```sh
node --env-file=.env --import tsx scripts/seed-feedback-demo.ts --create
```

The seed script preserves an existing demo clinic instead of resetting its feedback. It refuses production mode. No agent-platform files are changed.

## Separate Admin workspace

Clinic setup and the WhatsApp message-delivery settings now live in Admin. Sign in with `feedback.admin@demo.sahayak.in` / `demo1234`, then open **Patient check-in messages** on the Admin overview. Doctor feedback and reception follow-through stay in their own workspaces. See [clinic workspaces](clinic-workspaces.md).

## QR arrival demo (7 October 2026)

The synthetic clinic has QR arrivals enabled with a demo fee of ₹500. Open `/c/feedback-demo/poster` for the printable QR. Its current phone address is `http://192.168.1.5:3000/c/feedback-demo/arrival`, usable on the same Wi-Fi while the Mac's web and API servers are running.

Browser-tested with **QR Demo Patient**, synthetic phone ending 0005:
patient form → pending payment → receptionist confirmation → token 5 → doctor calls patient → finishes visit. This test did not collect real money or send a WhatsApp message. The patient did not grant messaging/follow-up permission, so the finish checklist correctly skipped feedback for this test visit. Integration tests separately verify automatic feedback scheduling with permission.

Settings: demo admin → Patient check-in QR. Payment confirmation: demo reception → QR arrivals. The doctor uses the normal Today screen. Use a new synthetic phone number for another demo arrival.
