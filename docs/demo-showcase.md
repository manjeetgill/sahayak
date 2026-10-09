# Sahayak interactive clinic demo

Open **http://localhost:3000/demo** on the Mac. The home page links to the same walkthrough. Switch between **Single doctor clinic** and **Clinic or small hospital**. Both use fictional, separate clinics in the local database.

## Prepare

1. Start the local database, API, and web app as usual. The API serves port 4000 and the web app serves port 3000.
2. Run `set -a; . ./.env; set +a; pnpm demo:seed` from the repository root. This adds missing demo clinics and keeps any practice changes already made.
3. To start over, run `set -a; . ./.env; set +a; pnpm demo:reset`. This deletes and recreates **only** the two exact `DEMO ·` clinics listed below. The command refuses a non-local database or a clinic with a matching slug but a different name. It clears all prior practice actions in those demo clinics.

The shared demo password is `demo1234`.

| Clinic | Role | Login |
| --- | --- | --- |
| Single doctor | Doctor and clinic owner | `doctor@solo.demo.test` |
| Single doctor | Optional receptionist | `desk@solo.demo.test` |
| Small hospital | Admin | `admin@hospital.demo.test` |
| Small hospital | Doctor | `kavita@hospital.demo.test` |
| Small hospital | Second doctor | `farah@hospital.demo.test` |
| Small hospital | Receptionist | `desk@hospital.demo.test` |

Sign out before changing staff roles. The hospital's second doctor has a separate queue and feedback preference. The solo doctor has admin access as the clinic owner.

## Show the moving workflow

The [in-app walkthrough](http://localhost:3000/demo) contains direct links for each selected clinic. Run these steps with either clinic:

1. **Assistant → team:** In the practice WhatsApp page, send `What are your hours?` from the prefilled fictional number. The assistant's reply is saved. Send `Let me speak to the receptionist` to transfer the practice conversation to a person. Open **Needs my attention** to see work for the clinic. The phone practice page accepts typed caller turns and shows the reply that would be spoken; it does not dial a number.
2. **Patient → reception → doctor:** Open the patient QR arrival page and enter a new fictional patient and phone number, such as `+910000000095`. Reception sees the arrival awaiting payment. Do not mark payment received unless acting out a verified fictional transaction. Asha Demo is already checked in, with a test cash payment and a queue token; Ravi Demo is already called. Open the doctor queue to see them move through the visit.
3. **Consultation:** As Dr. Kavita Rao, open Ravi Demo in **Today's clinic**. Review the pre-visit intake, unsigned note, and draft instructions. The doctor checks and signs any clinical note or instruction. The visit checklist shows remaining items and the upcoming feedback plan. Finish the visit after review.
4. **Automatic feedback scheduling:** Open **Patient feedback** and refresh. A new case for Ravi appears because the doctor's saved preference enables feedback after a finished visit. The invitation stays unsent because this demo clinic has no live WhatsApp delivery setup. Prepare a **private patient form link**, open it in a separate tab, and submit a fictional response. Refresh the doctor screen to see the response and assign the follow-up.
5. **Closed loop:** Meena Demo has an open clinic-experience concern and an improvement task; Kabir Demo has a closed feedback example. The doctor or receptionist can record contact and action. The **Needs my attention** list includes a prefilled callback request and a clearly marked urgent safety example. Urgent concerns need human review.
6. **Other linked work:** Show Meena's uploaded fictional PDF and report-review task, the care plan, the waiting-list offer for Kabir, and visit closeout. Admin can review assistant tasks, QR settings, roles, and delivery setup. The seed also includes a draft sample automation; it is intentionally inactive.

## What the demo proves

- The practice assistant uses the clinic's own saved hours and answers, stores conversations, and can hand off to a human.
- Patient arrival, reception review, queue, doctor work, feedback scheduling, private patient response, and follow-up are connected by real application records.
- The solo doctor can see admin controls. The hospital has separate admin, doctor, and reception logins.
- All seeded names, phone numbers, documents, messages, payments, and reports are fictional. No actual WhatsApp message, phone call, external software sync, or online payment occurs. A live channel requires its own real connection and verification.

The demo data should never be mixed with real patient records. `pnpm demo:reset` should be used only when the fictional work can be discarded.
