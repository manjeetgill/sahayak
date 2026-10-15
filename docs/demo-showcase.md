# Sahayak interactive clinic demo

Open **http://localhost:3000/demo** on the Mac. The home page links to the same walkthrough. Switch between **Single doctor clinic** and **Clinic or small hospital**. Both use fictional, separate clinics in the local database.

## Prepare

1. In the repository, run `pnpm demo:ready`. This starts PostgreSQL/Redis, applies migrations, creates missing fictional clinics, starts the API/web if needed, and checks all demo role logins.
2. For a fresh meeting with today's appointments, run `pnpm demo:ready --refresh-demo`. This clears prior practice work **only** in the two exact fictional demo clinics. The connected real clinic is untouched.
3. Open **http://localhost:3000/demo**, choose the clinic size, and use the doctor, admin, or reception sign-in buttons. No typing credentials is needed.
4. Use **Play the presentation** for a guided saved patient journey. It pauses for doctor review. Use **Agent demo** for a booking conversation, queue questions, clinic answers, and human handoff. You can open the linked clinic screens to inspect the saved records.
5. Optional pre-meeting check: `pnpm demo:check`. This runs Chrome against your actual localhost app, checks the hospital's three role logins, and completes a fictional journey through assigned feedback. It creates practice records; refresh the demo afterward if you want a clean start.

Doctor-running-late and cancellation notices in these two fictional clinics are saved in the practice conversation even when the separate live clinic uses the agent platform. They do not send external WhatsApp messages. A real clinic's connection is never replaced by this practice adapter.

The shared demo password is `demo1234`.

For guided one-click agent scenarios, open **http://localhost:3000/demo/agents**. Select either clinic and choose **Start agent demo**. This signs in as that clinic's fictional doctor on this browser. It shows the assistant's booking conversation, saved appointment, visit-day check-in and queue token, clinic answers, queue status, receptionist handoff, and urgent-message safety handling. The transcript updates after each message. If Dev's new booking is on a future date, Anaya Demo supplies a separate booking for today's check-in example. The page also links to phone practice and a draft automatic daily summary that the doctor can preview and approve. Booking alone does not put a patient in today's queue.

## Test a real WhatsApp journey

The fictional clinics above intentionally have no live number. To test from your own WhatsApp, sign in as the **owner/admin of the separate clinic that owns the business number** and open **Admin → Assistants → WhatsApp → Test a real patient journey**. Refresh its status first. It shows the active number only after the saved clinic channel has been verified against the platform. Send `Hi` from a WhatsApp number you control, finish the booking conversation with an explicit confirmation, refresh the received-event count, and check the saved appointment in the doctor view. Arrival, payment review when required, and queue token are later steps; booking alone does not check the patient in.

The same checklist links to **Today’s clinic** for the doctor-approved running-late proposal, **Patient feedback** after the visit, and **Admin → Patient check-in messages** for delivery setup. A finished visit schedules feedback according to the doctor’s saved preference. Real invitation delivery additionally needs patient consent, an approved WhatsApp invitation template and a public HTTPS patient-form origin. The delivery screen distinguishes a provider-accepted invitation from a confirmed delivery receipt and response.

Incoming and outgoing phone calls are separate from WhatsApp messages. Use **Assistants → Phone calls** for actual readiness and the provider-approved test-call path. A browser practice call does not dial a phone.

**Current local pilot status (9 October 2026):** the existing channel ending **1610** is attached to the current `dr-sharma` clinic. The platform still sends its former clinic ID in signed callbacks; Sahayak's private, channel-specific binding maps that exact old ID to the current local clinic after checking the channel, app and number. A signed local callback probe passed and the clinic setup reads **ACTIVE**. The owner's real `Hiii` received at 21:00 IST on 9 October was initially handed off because its platform conversation was in HUMAN mode. The authorized recovery resumed AUTO mode and queued only that unattempted message. Its reply reached SENT with a provider `delivered` receipt. The worker now leaves expired UNKNOWN replies quarantined without blocking new conversations; old messages were not replayed. The local Mac, API and private tunnel must remain running. Do not bind this channel to either fictional demo clinic.

The patient-message workers are enabled locally with `PATIENT_MESSAGES_JOBS_ENABLED=true`; `JOBS_ENABLED=false` keeps unrelated background jobs paused. The platform now supports Chakra template discovery and sending (release `68642cf`). The bound number and webhook were verified through `/send-setup` with HTTP 200. The feedback form is served at `https://shayak.myalgodesk.in/c/dr-sharma/feedback`; its four token-protected actions use the same origin. The local API has that HTTPS origin configured. The form loaded in Chrome, invalid tokens returned 400, and staff routes remained unavailable publicly.

**External approval still pending; automatic activation armed:** `sahayak_visit_feedback_v1` and `sahayak_evening_checkin_v1` remain `PENDING` with category `UTILITY` and no rejection reason in the last provider check. Both exact messages have been reviewed for the authorized pilot and saved with `activation_requested=true`, `enabled=false`. Sahayak checks every minute while patient-message jobs and the Mac are running. It activates only after the provider returns `APPROVED` with the same ID, name, language and text. Rejection, changed wording, lost connection or a clinic pause keeps delivery off. Normal consent, timing, language and idempotency checks still apply. No real invitation delivery has been verified yet. Admin → Patient check-in messages shows the pending choices and can cancel the request with Pause.

Platform outbound late notices and follow-up reminders still require their separate delivery integration; Sahayak counts these as **not messaged** or **failed** and raises staff follow-up work. Real outbound phone readiness remains unverified. Do not present those paths as working live.

**New patient touchpoints:** The private QR queue page now asks one optional question while the patient waits and puts the answer in the doctor’s queue and pre-visit brief. After a finished visit, the same private page can open the experience form if the doctor enabled feedback and the patient gave messaging/follow-up permission; the form asks separately about recovery, visit experience and suggestions. The doctor can also choose one to three evening recovery messages. Those need an additional patient opt-in on the QR page or the known patient’s WhatsApp command `EVENING YES`; `EVENING STOP` withdraws only that evening permission. An evening reply is saved for staff review, and worsening/help requests stop later automatic evenings. Admin approves an appropriate outbound template under **Patient check-in messages**. The present pilot still needs that approved template and active background jobs before live evening sending can be verified; the UI shows scheduled, submitted and provider-confirmed delivery separately.

**Callback rotation completed (9 October 2026):** with the user's explicit authorization, the channel was paused, the local and encrypted platform bindings plus deployment fallback were updated together, the new secret was accepted and the old secret rejected, and the channel was reactivated. A signed public callback still passed after the new platform deployment. Temporary rotation material was removed. Two old uncertain outbound records remain quarantined; they were not replayed. No secret is stored in Git or this document.

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

## One patient from booking to feedback

Open `/demo/journey` and choose **Single doctor** or **Clinic or small hospital**.
The guided rehearsal creates one fictional patient, books through the actual chat rules,
records QR arrival and practice cash payment, issues the queue token, opens the consultation,
saves a doctor-entered draft, requires review/signing and instruction approval, finishes the visit,
and schedules feedback using the doctor's preference. Complete the embedded private feedback
form, refresh the response, and assign follow-up to the doctor. The same patient record is used
throughout. These are saved database transitions, not a video or animated simulation.

This route is restricted to the two named fictional clinics, with no live WhatsApp binding or
Razorpay credentials. It is unavailable in production. It sends no real messages or payments.
In the hospital rehearsal the fictional receptionist records payment; the doctor signs the note.
Starting a rehearsal extends only the fictional clinic's hours for evening practice. Other waiting
or called practice patients go on hold when this patient is called; an active consultation is never
silently finished. Completed rehearsals remain in the fictional clinic's records.

## Where a real WhatsApp booking appears

Doctor and reception home screens now show **Upcoming appointments** with the clinic-local
date/time, doctor, booking source and status. Use the date picker for a particular day. These
lists refresh on booking events, window focus and a 30-second visible-page fallback. A booking
for tomorrow is not part of today's consultation queue. QR arrival/check-in adds the patient to
the queue. The connected Dr. Sharma clinic is separate from both fictional demo clinics.

## Doctor-running-late notices

A doctor must preview and confirm appointment changes. When the clinic uses the agent platform,
Sahayak saves a durable notice and the patient-message worker prepares and approves one
idempotent session message. A recent patient-initiated WhatsApp conversation, messaging consent,
verified connection, enabled channel and no human handoff are required. The platform checks the
conversation window again before dispatch. Notices expire after an hour; an uncertain send is
not retried. Changed/cancelled appointments and withdrawn consent stop dispatch from Sahayak.

The UI distinguishes queued notices from delivered notices. Provider acceptance alone does not
count as delivery; a delivery/read receipt does. Patients who cannot be reached are flagged for
staff contact. This session-message path does not bypass approval for proactive feedback or
nightly templates outside the active conversation window. Live phone calls and online payments
still require their own configured services and successful live tests.

## Doctor presentation: two sides of the same visit

Open `/demo/present` (also linked from the home page). Choose the clinic view, agree to the
fictional scenario, then click **Prepare the demo → Play demo**. Use **Full screen** for a
meeting. Presentation speed leaves time to explain each step; Quick rehearsal is useful before
arriving at the clinic. Pause and Next step let you control the pace.

The left side shows each real response from Sahayak's practice booking conversation, followed by
the patient QR/queue updates and a clearly labelled feedback invitation preview. The right side
shows saved appointment, payment, queue, note and feedback records for that same patient.

Playback pauses before signing. Review the displayed practice note and instructions, tick the
review box, and click **Approve practice note & continue**. The remaining steps finish the visit,
prepare the private form, submit a labelled example requesting clarification, and assign the
concern to the doctor. This is a follow-up task awaiting a person, not a resolved complaint.

The presentation uses its own demo sign-in, leaving the current clinic login untouched. Progress
is retained in the current browser tab across a reload. **Open this practice clinic’s feedback**
explicitly switches into the fictional doctor's workspace. A new patient allows another replay;
finish an active demonstration consultation before starting another.

No real phone is messaged or called, and no online payment is charged. Feedback delivery timing
is accelerated for presentation; the actual future schedule remains visible. The private form and
saved response use the normal clinic services. Live outbound invitation delivery still needs the
approved WhatsApp template and working connection described above.

### Hinglish video for a doctor meeting

The reproducible video source is in `scripts/doctor-demo/`. See its README for the
three commands to generate narration, record the complete journey and render an MP4.
The result is `artifacts/doctor-demo/Sahayak-Doctor-Demo-Hinglish.mp4`, with English
captions, synthetic Hinglish narration and chapter timestamps in the adjacent README.
Rendered media is kept out of Git. The recording uses a disposable test database and
does not send real WhatsApp messages or charge a payment.

The **clinic/hospital owner edition** uses `DEMO_AUDIENCE=owner` with the same
render commands. Its separate output is
`artifacts/owner-demo/Sahayak-Owner-Demo-Hinglish.mp4`. It covers how booking,
arrival/queue and follow-up responsibilities connect, which manual work can be
reduced, where staff remain involved, and a suggested pilot to measure workload.
It does not promise a particular staffing reduction or replace hospital clinical systems.

### Revised doctor video: everyday changes

`DEMO_AUDIENCE=workflow` produces
`artifacts/workflow-demo/Sahayak-Workflow-Demo-Hinglish.mp4`.
This cut removes owner/pilot advice and adds verified late-running, revised-time,
patient-reply, cancellation and replacement-booking scenes. The scenario cards
show actual saved API results from a separate fictional clinic, with simulator
messages. The remaining scenes follow the original booking-to-feedback journey.

## Capability explorer

The demo start page includes **What can Sahayak help with?**, with 34 existing capabilities grouped into before the visit, consultation, after the visit, clinic management, and connections. Search by task or filter by part of the clinic day. Each card explains the benefit and expands to show a demonstration action. Opening a staff capability signs into the appropriate fictional account for the selected clinic; this changes the session used by other tabs in the same browser. Patient pages open without changing the staff account. External service cards describe required setup and do not claim live delivery.

## Extended live-on-screen presentation

`/demo/present` now runs 20 saved steps: booking, a practice 15-minute delay proposal and confirmation, arrival/payment/queue, doctor review, private approved-instruction access, feedback and assigned follow-up. The presenter explicitly enables fictional practice actions; clinical signing still pauses for review. The delay may affect other future appointments for this doctor in the fictional clinic. No external messages are sent.

After doctor approval, **Open patient document copy** opens the existing token-protected patient page. It lists approved instructions only and offers the browser print/save-as-PDF action. This is not a prescription PDF or a claim of WhatsApp delivery. The private access link expires after seven days and is replaced when another access link is issued.
