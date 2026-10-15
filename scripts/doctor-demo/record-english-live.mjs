/* global sessionStorage, window */
import console from 'node:console';
import { chromium, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const out = resolve('artifacts/english-live-demo');
mkdirSync(out + '/work', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const films = {};
async function film(name, run) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    recordVideo: { dir: out + '/work', size: { width: 1440, height: 1000 } },
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const start = Date.now();
  const clips = [];
  async function scene(title, text, action) {
    const from = (Date.now() - start) / 1000;
    await action();
    await page.waitForTimeout(1800);
    clips.push({ title, text, start: from, duration: (Date.now() - start) / 1000 - from });
    console.log(name, title);
  }
  try {
    await run(page, scene);
    const video = page.video();
    await ctx.close();
    await video.saveAs(out + '/work/' + name + '.webm');
    films[name] = clips;
  } finally {
    await ctx.close();
  }
}
try {
  await film('patient-journey', async (p, scene) => {
    await p.goto('http://localhost:3000/demo/present');
    await p.getByLabel('Use fictional consent').check();
    await p.getByRole('button', { name: 'Prepare the demo', exact: true }).click();
    await expect(p.getByRole('button', { name: 'Play demo', exact: true })).toBeEnabled();
    await p.addStyleTag({
      content: 'main{max-width:1400px!important} [aria-label="Narration controls"]{display:none}',
    });
    await scene(
      'One patient, one connected visit',
      'Meet a patient who needs an appointment, and a clinic team working together to provide care. Watch how Sahayak connects the entire visit: booking, arrival, consultation, digital instructions and feedback. Each step updates the same patient journey, so the team can see what happens next.',
      async () => {},
    );
    const lines = [
      [
        'A patient starts with a message',
        'It is late in the evening, or the patient is somewhere they cannot make a call. They start with a simple hello. Here, the conversation opens the clinic’s booking flow, making it easier to begin without waiting for someone to answer the phone.',
      ],
      [
        'Request an appointment',
        'The patient asks to see the doctor. The assistant gathers the booking details through a short conversation. The clinic team spends less time answering routine appointment questions, while the doctor can stay focused on consultations.',
      ],
      [
        'First visit or follow-up',
        'Is this a first visit or a follow-up? The patient answers, and that information stays with the booking. The care team gets useful context before meeting the patient, rather than starting from scattered messages.',
      ],
      [
        'Check availability',
        'The assistant checks the clinic’s available times and presents the choices. The patient can choose a convenient appointment, while the doctor’s calendar remains the source for availability.',
      ],
      [
        'Choose a time',
        'The patient chooses a time. The assistant brings the booking details together for confirmation. This simple exchange turns an enquiry into a clear appointment request.',
      ],
      [
        'Booking saved',
        'The patient confirms, and the appointment appears in the clinic’s records. The clinic team can now see who is expected and when, without copying details from a chat into a separate diary.',
      ],
      [
        'Patient permission',
        'The patient chooses to receive clinic updates. Their preference is saved with the visit, so future communication follows their choice. The clinic team can manage the visit and communication from the same place.',
      ],
      [
        'The doctor is running late',
        'Now the doctor is running fifteen minutes late. One update identifies the affected appointments and prepares revised times. Instead of repeating the same explanation, an authorised team member reviews one organised change.',
      ],
      [
        'Appointment times update',
        'The change is confirmed and the appointment time updates. The revised booking supplies the details for the patient’s notice: what changed and when to arrive. This is how a schedule change becomes a useful message, with less coordination for the clinic team.',
      ],
      [
        'Arrival is recorded',
        'The patient arrives and checks in against the existing booking. Their visit is already recognised. The reception team can distinguish an expected appointment from someone who is now waiting to be seen.',
      ],
      [
        'Payment record and queue token',
        'Payment is recorded and a queue token is created. Arrival, the payment record and the queue are connected. The clinic team can see who is ready next, while the visit’s payment information stays in one place.',
      ],
      [
        'Use the waiting time',
        'While waiting, the patient adds a question they want to discuss. That concern stays with the visit. It gives the doctor a useful starting point and helps the patient remember what mattered to them.',
      ],
      [
        'The consultation begins',
        'The patient is called and the doctor begins the consultation. The queue updates with the visit, keeping the clinic team informed. Booking information and the patient’s concern are available together, helping the consultation start with context.',
      ],
      [
        'An editable note',
        'A draft note brings the consultation text into a structured form. The doctor can correct it before signing. This reduces repeated typing and makes it easier to leave a clear record of the visit.',
      ],
      [
        'Doctor review and approval',
        'The doctor reviews the note, signs it and approves the instructions. The doctor stays in control of the clinical content, while Sahayak organises the record and prepares the next steps for the patient.',
      ],
      [
        'A digital copy for the patient',
        'The approved instructions now have a private patient link. The clinic team can share this copy with the patient, so their next steps are easy to find after leaving. Patients can return to their instructions without asking the team for another paper copy.',
      ],
      [
        'Visit completed',
        'The doctor finishes the visit. The saved clinic setting schedules the feedback invitation automatically. Completing the consultation also starts the next stage of care, without creating a separate follow-up task by hand.',
      ],
      [
        'Feedback invitation',
        'Here is the message prepared for the patient, with a private feedback link. The completed visit supplies the context, and the clinic’s saved timing determines when it is due. For WhatsApp, the message’s delivery status is where the clinic team checks whether it reached the patient.',
      ],
      [
        'The patient responds',
        'The patient says the next steps need a clearer explanation. Their answer is saved against this visit. The care team can hear about a concern that might otherwise remain unspoken after the patient goes home.',
      ],
      [
        'Follow-up becomes visible',
        'The concern is assigned for follow-up and appears as work to address. The responsible team member can see who needs attention and why, with clinical questions directed to the doctor. Feedback becomes a practical opportunity to clarify instructions and improve the patient’s experience.',
      ],
    ];
    for (let i = 0; i < lines.length; i++)
      await scene(...lines[i], async () => {
        if (i === 14) {
          await p.getByLabel('I have reviewed this fictional note').check();
          await p
            .getByRole('button', { name: 'Approve practice note & continue', exact: true })
            .click();
          await p
            .getByRole('button', { name: 'Pause', exact: true })
            .click()
            .catch(() => {});
        } else await p.getByRole('button', { name: 'Next step →', exact: true }).click();
        await expect
          .poll(
            () =>
              p.evaluate(
                () => JSON.parse(sessionStorage.getItem('sahayak.demo.presentation.v2')).cursor,
              ),
            { timeout: 30000 },
          )
          .toBe(i + 1);
        await p.getByRole('region', { name: 'Patient view' }).scrollIntoViewIfNeeded();
      });
    const saved = await p.evaluate(() =>
      JSON.parse(sessionStorage.getItem('sahayak.demo.presentation.v2')),
    );
    if (saved.data.queue.status !== 'done' || saved.data.feedback.work_status !== 'assigned')
      throw Error('Journey incomplete');
    await scene(
      'The patient keeps the instructions',
      'This is the patient’s digital copy of the approved instructions. They can read it again, print it or save it as a PDF. From the first message to the information they take home, the visit stays connected. For the whole clinic team, that means less repetition and clearer follow-through.',
      async () => {
        await p.goto('http://localhost:3000' + saved.documentPath);
        await p
          .getByRole('heading', { name: 'Your approved visit instructions' })
          .scrollIntoViewIfNeeded();
        await expect(p.getByRole('button', { name: 'Print / save as PDF' })).toBeVisible();
      },
    );
  });
  await film('platform-capabilities', async (p, scene) => {
    await p.goto('http://localhost:3000/demo');
    await p.getByRole('button', { name: 'Clinic or small hospital', exact: true }).click();
    await p.getByRole('button', { name: 'Open admin view', exact: true }).click();
    await expect(p).toHaveURL(/\/admin$/);
    const tour = [
      [
        'Clinic overview',
        '/admin',
        'A clinic’s day includes much more than the consultation: bookings, waiting patients, reports, payments and questions after the visit. Sahayak brings those activities together. Let us look at the screens that help the whole clinic team keep the day organised and spend less time chasing updates.',
      ],
      [
        'Choose the help you need',
        '/admin/agents',
        'Choose the everyday help your clinic needs. Assistants can support patient entry, clinic questions, intake and follow-up tasks. The clinic can turn supported tasks on or pause them, and decide which doctors can use them. The help fits the way the clinic works.',
      ],
      [
        'Booking and patient entry',
        '/c/showcase-hospital/sim',
        'Consider a patient who cannot call during working hours. A text conversation lets them ask about the clinic and request an appointment. The assistant uses the clinic’s information and booking flow, reducing routine interruptions while making it easier for the patient to reach you.',
      ],
      [
        'Arrival and payments',
        '/admin/qr-checkin',
        'The arrival page brings check-in and consultation payment settings together. A patient’s arrival can connect to the booking and queue, while the payment record stays attached to the visit. Reception and the care team get a clearer picture of who has arrived and who is ready.',
      ],
      [
        'The clinic’s day',
        '/doctor',
        'Here is the clinic’s day: appointments, the waiting queue and items needing attention. If the doctor is delayed, an authorised team member can review revised times. One clear view helps the team coordinate the day without repeatedly asking each other for updates.',
      ],
      [
        'Cancelled slots',
        '/doctor/waitlist',
        'Someone cancels. The waiting list gives that opening a next step: offer it to an eligible patient who wants an earlier appointment. Offers expire, and acceptance is checked before the replacement booking is saved. This helps the clinic make better use of available consultation time.',
      ],
      [
        'Reports and referrals',
        '/doctor/care',
        'A test has been requested, but has the report come back? Has the doctor reviewed it? Has the patient been informed? These stages are visible here. The care team can spot unfinished follow-up and track responsibility instead of relying on memory.',
      ],
      [
        'Patient feedback',
        '/doctor/checkins',
        'Patients do not always explain their concerns in the consultation. A post-visit question gives them another opportunity. Responses come back to this screen, where the care team can see what needs attention, arrange follow-up and identify recurring suggestions for improvement.',
      ],
      [
        'Work requiring a person',
        '/doctor/inbox',
        'The inbox brings patient questions and concerns into one place. When a conversation needs personal attention, the context is available for a human handoff. The clinic team can handle routine requests and direct clinical questions to the doctor, with less searching through separate conversations.',
      ],
      [
        'Team access',
        '/admin/team',
        'A solo doctor can manage the clinic and care from one workspace. A larger clinic can divide access between the owner, doctors and reception. Each person gets the work relevant to their role, so responsibility is shared across the clinic team.',
      ],
      [
        'Connected services',
        '/admin/integrations',
        'Connected services help the clinic bring supported outside systems into its workflow. The clinic administrator can review the connection status here. The benefit is a connected visit with less repeated entry as services are linked to the clinic.',
      ],
      [
        'Patient check-in delivery',
        '/admin/messages',
        'This screen controls patient check-in messages. The clinic administrator chooses the invitation and timing once. When a visit finishes, Sahayak schedules the message with the patient’s private feedback link. The team follows the delivery status, and the patient’s response returns to the feedback screen for action.',
      ],
      [
        'Clinic activity and collections',
        '/doctor/practice',
        'The clinic owner and authorised team members can review clinic activity, recorded collections and outstanding amounts. This makes it easier to see what has been recorded and what needs attention, without piecing together the day from separate lists.',
      ],
      [
        'All existing capabilities',
        '/admin/features',
        'The feature directory brings the clinic’s tools together: patient records, dictation, doctor-selected prescriptions, certificates, care plans and paperwork tracking. Team members use the tools available to their role, while doctors review and approve clinical content. Information already captured can be reused, reducing repetitive work.',
      ],
    ];
    for (const [title, path, text] of tour)
      await scene(title, text, async () => {
        await p.goto('http://localhost:3000' + path);
        await p.locator('h1').first().waitFor();
        await p.evaluate(() => window.scrollTo(0, 0));
      });
    await scene(
      'More time for patient care',
      'The value is in a connected day. Patients can begin with a message. The clinic team manages arrivals, the queue and follow-up, while the doctor focuses on consultations and clinical decisions. Sahayak connects their work, so everyone can contribute to a clearer, more organised patient experience.',
      async () => {
        await p.goto('http://localhost:3000/demo#capabilities');
        await p.locator('#capabilities').scrollIntoViewIfNeeded();
      },
    );
  });
  writeFileSync(out + '/work/films.json', JSON.stringify(films, null, 2));
} finally {
  await browser.close();
}
