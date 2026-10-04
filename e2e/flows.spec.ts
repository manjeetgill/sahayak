import { test, expect } from '@playwright/test';
import { DB, login, simSend } from './helpers';

test.describe.configure({ mode: 'serial' });

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
  await sim.getByLabel(/Simulate a patient/).fill('9811122233');
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
  await sim.getByLabel(/Simulate a patient/).fill('9876501000');
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
  await sim.getByLabel(/Simulate a patient/).fill('9876501005');
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
  await rec.getByRole('button', { name: 'Open chat' }).first().click();
  await rec.getByRole('button', { name: 'Take over' }).click();
  await rec.getByLabel('Reply').fill('We are sending help. Are you at home?');
  await rec.getByRole('button', { name: 'Send' }).click();
  await expect(sim.getByTestId('chat')).toContainText('We are sending help');
});
