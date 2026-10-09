# Sahayak interactive clinic demo

Open **http://localhost:3000/demo** on the Mac. The home page links to the same walkthrough. Switch between **Single doctor clinic** and **Clinic or small hospital**. Both use fictional, separate clinics in the local database.

## Prepare

1. Start the local database, API, and web app as usual. The API serves port 4000 and the web app serves port 3000.
2. Run `set -a; . ./.env; set +a; pnpm demo:seed` from the repository root. This adds missing demo clinics and keeps any practice changes already made.
3. To start over, run `set -a; . ./.env; set +a; pnpm demo:reset`. This deletes and recreates **only** the two exact `DEMO ·` clinics listed below. The command refuses a non-local database or a clinic with a matching slug but a different name. It clears all prior practice actions in those demo clinics.

The shared demo password is `demo1234`.

For guided one-click agent scenarios, open **http://localhost:3000/demo/agents**. Select either clinic and choose **Start agent demo**. This signs in as that clinic's fictional doctor on this browser. It shows the assistant's booking conversation, saved appointment, visit-day check-in and queue token, clinic answers, queue status, receptionist handoff, and urgent-message safety handling. The transcript updates after each message. If Dev's new booking is on a future date, Anaya Demo supplies a separate booking for today's check-in example. The page also links to phone practice and a draft automatic daily summary that the doctor can preview and approve. Booking alone does not put a patient in today's queue.

## Test a real WhatsApp journey

The fictional clinics above intentionally have no live number. To test from your own WhatsApp, sign in as the **owner/admin of the separate clinic that owns the business number** and open **Admin → Assistants → WhatsApp → Test a real patient journey**. Refresh its status first. It shows the active number only after the saved clinic channel has been verified against the platform. Send `Hi` from a WhatsApp number you control, finish the booking conversation with an explicit confirmation, refresh the received-event count, and check the saved appointment in the doctor view. Arrival, payment review when required, and queue token are later steps; booking alone does not check the patient in.

The same checklist links to **Today’s clinic** for the doctor-approved running-late proposal, **Patient feedback** after the visit, and **Admin → Patient check-in messages** for delivery setup. A finished visit schedules feedback according to the doctor’s saved preference. Real invitation delivery additionally needs patient consent, an approved WhatsApp invitation template and a public HTTPS patient-form origin. The delivery screen distinguishes a provider-accepted invitation from a confirmed delivery receipt and response.

Incoming and outgoing phone calls are separate from WhatsApp messages. Use **Assistants → Phone calls** for actual readiness and the provider-approved test-call path. A browser practice call does not dial a phone.

**Current local pilot status (9 October 2026):** the existing channel ending **1610** is attached to the current `dr-sharma` clinic. The platform still sends its former clinic ID in signed callbacks; Sahayak's private, channel-specific binding maps that exact old ID to the current local clinic after checking the channel, app and number. A signed local callback probe passed and the clinic setup reads **ACTIVE**. A new WhatsApp `Hi` from the owner's phone is still required to prove real inbound and reply delivery. The local Mac, API and private tunnel must remain running. Do not bind this channel to either fictional demo clinic.

The patient-message workers are enabled locally with `PATIENT_MESSAGES_JOBS_ENABLED=true`; `JOBS_ENABLED=false` keeps unrelated background jobs paused. Clinic delivery approvals remain off. The public patient-form HTTPS origin is unset, and the current platform provider rejects outbound template setup with HTTP 409 because its template catalogue is not implemented. Automatic live feedback invitations therefore remain off. The existing public host returns 404 for the feedback page until its routing is configured. Platform outbound late notices and follow-up reminders are unavailable: Sahayak counts these as **not messaged** or **failed** and raises staff follow-up work instead of reporting a practice message as sent. Voice readiness remains unavailable. Those features need their separate delivery/provider work before a live test can pass.

**New patient touchpoints:** The private QR queue page now asks one optional question while the patient waits and puts the answer in the doctor’s queue and pre-visit brief. After a finished visit, the same private page can open the experience form if the doctor enabled feedback and the patient gave messaging/follow-up permission; the form asks separately about recovery, visit experience and suggestions. The doctor can also choose one to three evening recovery messages. Those need an additional patient opt-in on the QR page or the known patient’s WhatsApp command `EVENING YES`; `EVENING STOP` withdraws only that evening permission. An evening reply is saved for staff review, and worsening/help requests stop later automatic evenings. Admin approves an appropriate outbound template under **Patient check-in messages**. The present pilot still needs that approved template and active background jobs before live evening sending can be verified; the UI shows scheduled, submitted and provider-confirmed delivery separately.

**Operator follow-up:** rotate the pilot callback signing secret before exposing the connection more broadly. A local diagnostic error printed the previous secret. The platform's setup API rejects a changed binding for an enabled channel, so this needs the platform operator's supported pause/migration procedure and a matching private Sahayak `.env` update. The attempted API change returned 422 and did not change either side. Recheck a signed probe and a real owner-initiated `Hi` afterward; never put the secret in Git or chat.

| Clinic         | Role                    | Login                       |
| -------------- | ----------------------- | --------------------------- |
| Single doctor  | Doctor and clinic owner | `doctor@solo.demo.test`     |
| Single doctor  | Optional receptionist   | `desk@solo.demo.test`       |
| Small hospital | Admin                   | `admin@hospital.demo.test`  |
| Small hospital | Doctor                  | `kavita@hospital.demo.test` |
| Small hospital | Second doctor           | `farah@hospital.demo.test`  |
| Small hospital | Receptionist            | `desk@hospital.demo.test`   |

Sign out before changing staff roles. The hospital's second doctor has a separate queue and feedback preference. The solo doctor has admin access as the clinic owner.

## Show the moving workflow

The [in-app walkthrough](http://localhost:3000/demo) contains direct links for each selected clinic. Run these steps with either clinic:

1. **Assistant → appointment:** In the agent showcase, run Dev Demo's booking. The assistant asks visit type and preferred time, offers available slots, asks for confirmation, and saves the appointment. Open Dev's patient record to show it. The same screen can answer clinic hours, hand a conversation to a receptionist, and flag a fictional urgent concern. The phone practice page accepts typed caller turns and shows the reply that would be spoken; it does not dial a number.
2. **Appointment → arrival → queue:** Use the agent showcase's check-in button for a booked-today fictional patient. It links today's appointment and issues the next queue token. Ask the assistant for the patient's token; this works even while intake questions are open. The separate **QR arrival** page demonstrates the payment-required path: an arrival waits at reception until staff checks payment, then confirmation issues the token. Do not represent a patient saying “paid” as payment verification. Asha Demo is already checked in with a test cash payment, and Ravi Demo is already called.
3. **Consultation:** As Dr. Kavita Rao, open Ravi Demo in **Today's clinic**. Review the pre-visit intake, unsigned note, and draft instructions. The doctor checks and signs any clinical note or instruction. The visit checklist shows remaining items and the upcoming feedback plan. Finish the visit after review.
4. **Automatic feedback scheduling:** Open **Patient feedback** and refresh. A new case for Ravi appears because the doctor's saved preference enables feedback after a finished visit. The invitation stays unsent because this demo clinic has no live WhatsApp delivery setup. Prepare a **private patient form link**, open it in a separate tab, and submit a fictional response. Refresh the doctor screen to see the response and assign the follow-up.
   In the same screen, open **Automatic check-ins** for the waiting-room question and evening schedule. The **Patient responses** tab shows Meena Demo’s fictional evening reply, labelled as a practice example rather than a delivered WhatsApp message.
5. **Closed loop:** Meena Demo has an open clinic-experience concern and an improvement task; Kabir Demo has a closed feedback example. The doctor or receptionist can record contact and action. The **Needs my attention** list includes a prefilled callback request and a clearly marked urgent safety example. Urgent concerns need human review.
6. **Other linked work:** Show Meena's uploaded fictional PDF and report-review task, the care plan, the waiting-list offer for Kabir, and visit closeout. Admin can review assistant tasks, QR settings, roles, and delivery setup. The seed also includes a draft sample automation; it is intentionally inactive.

## What the demo proves

- The practice assistant uses the clinic's own saved hours and answers, stores conversations, and can hand off to a human. The daily summary is a valid draft for preview; staff contact and message delivery are still needed to send it.
- The assistant checks actual free slots before booking and asks the patient to confirm. The patient reaches the queue only when they check in on the visit day. Queue questions do not overwrite intake answers.
- Patient arrival, reception review, queue, doctor work, feedback scheduling, private patient response, and follow-up are connected by real application records.
- The solo doctor can see admin controls. The hospital has separate admin, doctor, and reception logins.
- All seeded names, phone numbers, documents, messages, payments, and reports are fictional. No actual WhatsApp message, phone call, external software sync, or online payment occurs. A live channel requires its own real connection and verification.

The demo data should never be mixed with real patient records. `pnpm demo:reset` should be used only when the fictional work can be discarded.
