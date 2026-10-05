import { test, expect } from '@playwright/test';
import { DB, login, simSend } from './helpers';

test.describe.configure({ mode: 'default' });

test('new patient journey: QR check-in → token → TV → doctor calls → TV updates', async ({
  page,
  browser,
}) => {
  // Waiting-room TV
  const tv = await (await browser.newContext()).newPage();
  await tv.goto('/c/dr-sharma/tv');
  await expect(tv.getByTestId('now-serving').first()).toHaveText('–');

  // Patient scans QR → check-in (Hindi toggle works too)
  await page.goto('/c/dr-sharma/checkin');
  await page.getByLabel('Mobile number').fill('9811122233');
  await page.getByLabel('Mobile number').blur();
  await page.getByLabel('Your name').fill('Test Patient');
  await page.getByRole('button', { name: 'Get my token' }).click();
  await expect(page.locator('.error')).toContainText('Consent'); // consent is mandatory
  await page.getByLabel(/I agree that the clinic may store/).check();
  await page.getByLabel(/receive messages about my visit/).check();
  await page.getByRole('button', { name: 'Get my token' }).click();
  await expect(page.getByTestId('token')).toHaveText('1');

  // TV shows it as next (live over WebSocket, no reload)
  await expect(tv.locator('.tvnext').first()).toContainText('1');

  // Receptionist sees the live queue
  const rec = await (await browser.newContext()).newPage();
  await login(rec, 'reception@demo.sahayak.in');
  await expect(rec.getByText('Test Patient').first()).toBeVisible();

  // Doctor presses Next patient
  const doc = await (await browser.newContext()).newPage();
  await login(doc, 'anil@demo.sahayak.in');
  await doc.getByRole('button', { name: /Next patient/ }).click();
  await expect(doc.getByTestId('patient-card')).toContainText('Test Patient');
  await expect(tv.getByTestId('now-serving').first()).toHaveText('1');
  // Patient received the intake questions + turn notice on the WhatsApp simulator
  const sim = await (await browser.newContext()).newPage();
  await sim.goto('/c/dr-sharma/sim');
  await sim.getByLabel(/Practice patient phone number/).fill('9811122233');
  await expect(sim.getByTestId('chat')).toContainText('your token');
  await expect(sim.getByTestId('chat')).toContainText('main reason');
});

test('running-late flow: doctor → impact → one tap confirm → patients notified → reply → live summary', async ({
  browser,
}) => {
  const hour = Number(
    new Date().toLocaleString('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      hour12: false,
    }),
  );
  test.skip(hour >= 22, 'test clinic hours end 23:45 IST; late shifts would cross midnight');
  // Put two consenting seeded patients in the next hour with Dr. Anil.
  const db = DB();
  await db.connect();
  const clinic = (await db.query("SELECT id FROM clinics WHERE slug='dr-sharma'")).rows[0].id;
  const doc1 = (await db.query("SELECT id FROM doctors WHERE name='Dr. Anil Sharma'")).rows[0].id;
  // Open all day so the test does not depend on the weekday or time of day.
  await db.query('UPDATE clinic_settings SET timings=$2 WHERE clinic_id=$1', [
    clinic,
    JSON.stringify(
      Object.fromEntries(
        ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, '00:00-23:45']),
      ),
    ),
  ]);
  await db.query('DELETE FROM follow_ups');
  await db
    .query('DELETE FROM appointments WHERE doctor_id=$1 AND starts_at > now()', [doc1])
    .catch(() => {});
  await db.query(
    "UPDATE appointments SET status='cancelled' WHERE doctor_id=$1 AND ends_at > now()",
    [doc1],
  );
  const pats = (
    await db.query(
      "SELECT id, phone FROM patients WHERE phone IN ('+919876501000','+919876501001') ORDER BY phone",
    )
  ).rows;
  for (const [i, p] of pats.entries())
    await db.query(
      "INSERT INTO appointments (clinic_id,doctor_id,patient_id,starts_at,ends_at,source) VALUES ($1,$2,$3, date_trunc('minute', now()) + make_interval(mins => $4), date_trunc('minute', now()) + make_interval(mins => $4+15),'manual')",
      [clinic, doc1, p.id, 20 + i * 15],
    );
  await db.end();

  const doc = await (await browser.newContext()).newPage();
  await login(doc, 'anil@demo.sahayak.in');
  await doc.getByLabel('Running late').fill('running 30 min late');
  await doc.getByRole('button', { name: 'Check impact' }).click();
  await expect(doc.getByTestId('late-proposal')).toContainText('2 patient(s) affected');
  await expect(doc.getByTestId('late-proposal')).toContainText('Nothing is sent until you confirm');

  // Nothing sent yet
  const sim = await (await browser.newContext()).newPage();
  await sim.goto('/c/dr-sharma/sim');
  await sim.getByLabel(/Practice patient phone number/).fill('9876501000');
  await expect(sim.getByTestId('chat')).not.toContainText(/30 minutes late|30 मिनट देर/);

  await doc.getByRole('button', { name: 'Confirm and notify patients' }).click();
  await expect(doc.getByTestId('late-summary')).toContainText('2/2 notified');
  await expect(sim.getByTestId('chat')).toContainText(/30 minutes late|30 मिनट देर/); // this seeded patient prefers Hindi

  // Patient replies "1" → kept; doctor's live summary updates
  await simSend(sim, '1');
  await expect(doc.getByTestId('late-summary')).toContainText('1 kept new time');
});

test('red-flag escalation: patient message → emergency reply → urgent alert on console and doctor screen', async ({
  browser,
}) => {
  const sim = await (await browser.newContext()).newPage();
  await sim.goto('/c/dr-sharma/sim');
  await sim.getByLabel(/Practice patient phone number/).fill('9876501005');
  const rec = await (await browser.newContext()).newPage();
  await login(rec, 'reception@demo.sahayak.in');
  const doc = await (await browser.newContext()).newPage();
  await login(doc, 'meera@demo.sahayak.in');
  await expect(rec.locator('.banner.urgent')).toHaveCount(0);

  await simSend(sim, 'mujhe seene mein bahut dard ho raha hai');
  await expect(sim.getByTestId('chat')).toContainText('108');
  await expect(rec.locator('.banner.urgent')).toBeVisible();
  await expect(doc.locator('.banner.urgent')).toBeVisible();
  // Receptionist can take over the chat
  await rec.getByRole('button', { name: 'Review conversation' }).first().click();
  await rec.getByRole('button', { name: 'Reply myself', exact: true }).first().click();
  await rec.getByLabel('Reply').fill('We are sending help. Are you at home?');
  await rec.getByRole('button', { name: 'Send' }).click();
  await expect(sim.getByTestId('chat')).toContainText('We are sending help');
});

test('agent builder: doctor adds an FAQ and switches an agent; the assistant follows it', async ({
  browser,
}) => {
  const doc = await (await browser.newContext()).newPage();
  await login(doc, 'anil@demo.sahayak.in');
  await doc.getByRole('link', { name: 'Clinic settings' }).click();
  await doc.getByRole('button', { name: 'Add FAQ' }).click();
  await doc.getByLabel('FAQ 1 keywords').fill('parking, scooter');
  await doc.getByLabel('FAQ 1 answer English').fill('Free parking is behind the building.');
  await doc.getByLabel('FAQ 1 answer Hindi').fill('मुफ़्त पार्किंग इमारत के पीछे है।');
  await doc.getByRole('button', { name: 'Save FAQs' }).click();
  await expect(doc.getByRole('status')).toHaveText('Saved');

  const sim = await (await browser.newContext()).newPage();
  await sim.goto('/c/dr-sharma/sim');
  await sim.getByLabel(/Practice patient phone number/).fill('9876501010');
  await simSend(sim, 'is there scooter parking?');
  await expect(sim.getByTestId('chat')).toContainText('Free parking is behind the building.');

  // Phone call simulator uses the same agents
  const call = await (await browser.newContext()).newPage();
  await call.goto('/c/dr-sharma/call');
  await call.getByLabel('Caller says').fill('I have chest pain');
  await call.getByRole('button', { name: 'Send' }).click();
  await expect(call.getByTestId('call-log')).toContainText('108');
});

test('safety report page shows protections, eval results and the audit log', async ({
  browser,
}) => {
  const rec = await (await browser.newContext()).newPage();
  await login(rec, 'reception@demo.sahayak.in');
  await rec.getByRole('link', { name: 'Safety report' }).click();
  await expect(rec.getByTestId('controls')).toContainText('Each clinic can only see its own data');
  await expect(rec.getByTestId('controls').locator('[aria-label="ok"]')).toHaveCount(6);
  await expect(rec.getByTestId('eval')).toContainText('48/48');
  await expect(rec.getByTestId('audit').locator('tbody tr').first()).toBeVisible();
  await rec.getByLabel('Filter').selectOption('red_flag');
  await expect(rec.getByTestId('audit')).toContainText('Emergency alert');
});

test('integrations: doctor creates an API key (shown once) and the key works', async ({
  browser,
  request,
}) => {
  const doc = await (await browser.newContext()).newPage();
  await login(doc, 'anil@demo.sahayak.in');
  await doc.getByRole('link', { name: 'Clinic settings' }).click();
  await doc.getByText('Connected software — for your setup team', { exact: true }).click();
  await doc.getByRole('link', { name: 'Open connected software settings' }).click();
  await doc.getByLabel('Key name').fill('e2e');
  await doc.getByLabel('Key access').selectOption('read');
  await doc.getByRole('button', { name: 'Create key' }).click();
  const key = (await doc.getByTestId('new-key').locator('div').first().innerText()).trim();
  expect(key).toMatch(/^shy_[0-9a-f]{8}_[0-9a-f]{32}$/);
  const r = await request.get(`http://127.0.0.1:${process.env.E2E_API_PORT ?? '4100'}/v1/doctors`, {
    headers: { authorization: `Bearer ${key}` },
  });
  expect(r.status()).toBe(200);
  expect((await r.json()).length).toBe(2);
  await doc.getByRole('button', { name: 'I saved it' }).click();
  await expect(doc.getByTestId('new-key')).toHaveCount(0);
  doc.once('dialog', (d) => d.accept());
  await doc.getByRole('button', { name: 'Revoke' }).click();
  await expect(doc.getByText('revoked')).toBeVisible();
});

test('guided setup: sign up, walk the seven steps, go live, print poster, receptionist can sign in', async ({
  browser,
}) => {
  const name = `E2E Clinic ${Date.now().toString(36)}`;
  const email = `owner-${Date.now()}@e2e.in`;
  const page = await (await browser.newContext()).newPage();
  await page.goto('/signup');
  await page.getByLabel('Invite code').fill('wrong');
  await page.getByLabel('Clinic name').fill(name);
  await page.getByLabel('Your name (doctor)').fill('Dr. E2E');
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill('a-long-password-1');
  await page.getByRole('button', { name: 'Create my clinic' }).click();
  await expect(page.locator('.error')).toContainText('invite code is not valid');
  await page.getByLabel('Invite code').fill('e2e-invite');
  await page.getByRole('button', { name: 'Create my clinic' }).click();
  await expect(page).toHaveURL(/\/setup/);

  // 1 Clinic
  await page.getByLabel('Address').fill('7 Setup Road, Ludhiana');
  await page.getByLabel('Clinic phone').fill('+911612345000');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  // 2 Hours
  await page.getByRole('button', { name: 'Use Mon-Sat 9-1 and 5-8' }).click();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  // 3 Doctors: add a second doctor
  await page.getByLabel('Doctor name').fill('Dr. Second E2E');
  await page.getByRole('button', { name: 'Add doctor' }).click();
  await expect(page.getByText('Dr. Second E2E')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  // 4 Team
  await page.getByLabel('Receptionist name').fill('Rita');
  const recEmail = `rita-${Date.now()}@e2e.in`;
  await page.getByLabel('Receptionist email').fill(recEmail);
  await page.getByRole('button', { name: 'Generate' }).click();
  const recPassword = await page.getByLabel('Temporary password').inputValue();
  expect(recPassword.length).toBeGreaterThanOrEqual(10);
  await page.getByRole('button', { name: 'Create login' }).click();
  await expect(page.getByTestId('created-login')).toContainText(recEmail);
  await page.getByRole('button', { name: 'Continue' }).click();
  // 5 Questions
  await page.getByLabel(/parking/).check();
  await page.getByLabel('parking answer English').fill('Free parking behind the clinic.');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  // 6 Try it: chat as a patient in the simulator
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const sim = await (await browser.newContext()).newPage();
  await sim.goto(`/c/${slug}/sim`);
  await sim.getByLabel(/Practice patient phone number/).fill('9876500099');
  await simSend(sim, 'is there parking?');
  await expect(sim.getByTestId('chat')).toContainText('Free parking behind the clinic.');
  await page.getByRole('button', { name: 'I tried it: refresh checklist' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  // 7 Go live
  // everything done except the optional WhatsApp number (the simulator stands in for it)
  await expect(page.getByTestId('checklist').locator('[aria-label="done"]')).toHaveCount(7);
  await expect(page.getByTestId('checklist')).toContainText('WhatsApp number linked');
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByText('Your clinic is live.')).toBeVisible();
  const poster = await (await browser.newContext()).newPage();
  await poster.goto(`/c/${slug}/poster`);
  await expect(poster.getByRole('heading', { name: name })).toBeVisible();
  await expect(poster.locator('svg').first()).toBeVisible();
  // no setup banner any more, and the receptionist can sign in with the generated password
  await page.goto('/doctor');
  await expect(page.getByText('Your clinic setup is not finished')).toHaveCount(0);
  const rec = await (await browser.newContext()).newPage();
  await rec.goto('/login');
  await rec.getByLabel('Email').fill(recEmail);
  await rec.getByLabel('Password').fill(recPassword);
  await rec.getByRole('button', { name: 'Sign in' }).click();
  await expect(rec).toHaveURL(/\/console/);
});

test('ask your clinic: doctor asks in plain words and gets an answer', async ({ browser }) => {
  const doc = await (await browser.newContext()).newPage();
  await login(doc, 'anil@demo.sahayak.in');
  await doc.getByLabel('Ask your clinic').fill('appointments tomorrow');
  await doc.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(doc.getByTestId('ask-clinic')).toContainText('appointment(s) tomorrow');
  await doc.getByRole('button', { name: "Today's summary" }).click();
  await expect(doc.getByTestId('ask-clinic')).toContainText('Daily summary for');
  await doc.getByLabel('Ask your clinic').fill('मुझे आज कितने मरीज़ आए');
  await doc.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(doc.getByTestId('ask-clinic')).toContainText('मरीज़ देखे गए');
});

test('visit-note scribe: doctor dictates, reviews, signs; patient sends a report on WhatsApp', async ({
  browser,
}) => {
  const doc = await (await browser.newContext()).newPage();
  await login(doc, 'anil@demo.sahayak.in');
  await doc.getByLabel('Find a patient').fill('Aarav');
  await doc.getByRole('button', { name: 'Search' }).click();
  await doc.getByRole('link', { name: /Aarav/ }).click();
  await expect(doc.getByRole('heading', { name: /Aarav/ }).first()).toBeVisible();

  await doc
    .getByLabel('Dictation', { exact: true })
    .fill(
      'Complaint: knee pain two weeks. Diagnosis: mild strain. Plan: rest and warm compress. Follow up: 10 days',
    );
  await doc.getByRole('button', { name: 'Arrange note' }).click();
  await expect(doc.getByLabel('Diagnosis')).toHaveValue('mild strain');
  await expect(doc.getByLabel('Complaint')).toHaveValue('knee pain two weeks');
  // the doctor corrects a word before signing
  await doc.getByLabel('Diagnosis').fill('mild ligament strain');
  doc.once('dialog', (d) => d.accept());
  await doc.getByRole('button', { name: 'Save and sign' }).click();
  await expect(doc.getByTestId('signed-notes')).toContainText('mild ligament strain');

  // the patient sends a report on WhatsApp; it shows up on the record
  const sim = await (await browser.newContext()).newPage();
  await sim.goto('/c/dr-sharma/sim');
  await sim.getByLabel(/Practice patient phone number/).fill('9876501000');
  await sim.getByLabel('Attach file').setInputFiles('e2e/files/report.pdf');
  await expect(sim.getByTestId('chat')).toContainText(/Received your PDF|आपकी PDF मिल गई/);
  await doc.reload();
  await expect(doc.getByTestId('documents')).toContainText('report.pdf');
  await expect(doc.getByTestId('documents')).toContainText('New');
});

test('certificate: doctor drafts, signs with password, sends on WhatsApp; anyone can verify it', async ({
  browser,
}) => {
  const doc = await (await browser.newContext()).newPage();
  await login(doc, 'anil@demo.sahayak.in');
  // professional details are required before signing
  await doc.getByRole('link', { name: 'Clinic settings' }).click();
  await doc.getByLabel('Medical registration number').fill('PMC-12345');
  await doc.getByLabel('Qualifications').fill('MBBS, MD');
  await doc.getByRole('button', { name: 'Save professional details' }).click();
  await expect(doc.getByRole('status').first()).toHaveText('Saved');
  await doc.getByRole('link', { name: /Back to doctor screen/ }).click();
  await doc.getByLabel('Find a patient').fill('Vivaan');
  await doc.getByRole('button', { name: 'Search' }).click();
  await doc.getByRole('link', { name: /Vivaan/ }).click();
  await doc.getByRole('button', { name: 'New sick-leave certificate' }).click();
  await doc.getByLabel('Remarks (optional)').fill('Rest advised');
  await doc.getByRole('button', { name: 'Create draft' }).click();
  await expect(doc.getByTestId('doc-draft')).toContainText('Sick-leave certificate');
  await doc.getByRole('button', { name: 'Review and sign' }).click();
  await doc.getByLabel('Enter your password to sign').fill('wrong-password');
  await doc.getByTestId('sign-dialog').getByRole('button', { name: 'Sign', exact: true }).click();
  await expect(doc.locator('.error')).toContainText('password is not correct');
  await doc.getByLabel('Enter your password to sign').fill('demo1234');
  await doc.getByTestId('sign-dialog').getByRole('button', { name: 'Sign', exact: true }).click();
  await expect(doc.getByTestId('doc-signed')).toContainText('CERT-');
  await doc.getByRole('button', { name: 'Send on WhatsApp' }).click();
  await expect(doc.getByRole('status').filter({ hasText: 'Sent to the patient' })).toBeVisible();

  // the patient got a private link on WhatsApp
  const sim = await (await browser.newContext()).newPage();
  await sim.goto('/c/dr-sharma/sim');
  await sim.getByLabel(/Practice patient phone number/).fill('9876501001');
  await expect(sim.getByTestId('chat')).toContainText(/\/d\//);

  // anyone with the code can verify it, and sees no medical content
  const db = DB();
  await db.connect();
  const code = (
    await db.query(
      "SELECT verify_code FROM issued_documents WHERE status='signed' ORDER BY signed_at DESC LIMIT 1",
    )
  ).rows[0].verify_code;
  await db.end();
  const pub = await (await browser.newContext()).newPage();
  await pub.goto(`/verify/${code}`);
  await expect(pub.getByTestId('verify-ok')).toContainText('genuine');
  await expect(pub.getByTestId('verify-ok')).toContainText('PMC-12345');
  await expect(pub.getByTestId('verify-ok')).not.toContainText('Rest advised');
  await pub.goto('/verify/AAAAAAAAAAAA');
  await expect(pub.getByTestId('verify-bad')).toBeVisible();
});

test('public clinic page shows what the clinic published, with a booking link', async ({
  page,
}) => {
  await page.goto('/c/dr-sharma');
  await expect(page.getByRole('heading', { name: "Dr. Sharma's Clinic" })).toBeVisible();
  await expect(page.getByText('Dr. Anil Sharma')).toBeVisible();
  await expect(page.getByText('Opening hours')).toBeVisible();
  await expect(page.getByRole('link', { name: /Check in/ })).toHaveAttribute(
    'href',
    '/c/dr-sharma/checkin',
  );
  await expect(page.getByText('Open in Maps')).toBeVisible();
  expect(await page.locator('script[type="application/ld+json"]').innerText()).toContain(
    'MedicalClinic',
  );
});

test('custom agent: describe in plain words, review exactly what it will do, approve, pause', async ({
  browser,
}) => {
  const db = DB();
  await db.connect();
  await db.query("UPDATE patients SET tags='{diabetic}' WHERE phone='+919876501002'"); // consenting seeded patient
  await db.end();
  const doc = await (await browser.newContext()).newPage();
  await login(doc, 'anil@demo.sahayak.in');
  await doc.getByRole('link', { name: 'Clinic assistants', exact: true }).click();
  await doc.getByRole('button', { name: 'Reminders & updates', exact: true }).click();
  await doc.getByLabel('What would you like help with?').fill('remind my diabetic patients every month');
  await doc.getByRole('button', { name: 'Prepare a draft' }).click();
  await expect(doc.getByTestId('agent-preview')).toContainText('On day 1 of every month at 10 am');
  await expect(doc.getByTestId('agent-preview')).toContainText('agreed to messages and reminders');
  await expect(doc.getByTestId('agent-preview')).toContainText('reach 1 patient');

  // the safety rules cannot be talked around: a link is refused, with the reason
  await doc.getByLabel(/Message \(English\)/).fill('Pay now at https://evil.example/pay');
  await doc.getByRole('button', { name: 'Check what it will do' }).click();
  await expect(doc.getByTestId('agent-problems')).toContainText('cannot contain links');
  await expect(doc.getByRole('button', { name: 'Approve and turn on' })).toBeDisabled();

  await doc
    .getByLabel(/Message \(English\)/)
    .fill('Hello {name}, please book your check-up at {clinic}.');
  await doc.getByRole('button', { name: 'Check what it will do' }).click();
  await doc.getByRole('button', { name: 'Approve and turn on' }).click();
  await expect(doc.getByTestId('agent-list')).toContainText('On');
  await expect(doc.getByTestId('agent-list')).toContainText('Next scheduled time');
  await doc.getByRole('button', { name: 'Pause' }).click();
  await expect(doc.getByTestId('agent-list')).toContainText('Paused');
});
