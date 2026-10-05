// Run against local dev servers: node --import tsx scripts/verify-care-ui.mjs
// ADMIN_DATABASE_URL must be loaded. Creates and removes only its own synthetic clinic.
import pg from 'pg';
import process from 'node:process';
import console from 'node:console';
import { chromium } from '@playwright/test';
import {
  createTestClinic,
  dropTestClinic,
  addPatient,
  hashPassword,
} from '../packages/db/src/index.ts';

const db = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
await db.connect();
let clinic, browser;
try {
  clinic = await createTestClinic(db, 'care-ui');
  const patient = await addPatient(
    db,
    clinic.clinicId,
    'Synthetic Workflow Patient',
    '+199900099111',
    { whatsapp: false },
  );
  const email = `${clinic.slug}@test.invalid`,
    password = 'temporary-test-password';
  await db.query(
    "INSERT INTO staff_users(clinic_id,email,password_hash,name,role,doctor_id) VALUES ($1,$2,$3,'Synthetic Doctor','doctor',$4)",
    [clinic.clinicId, email, await hashPassword(password), clinic.doctorIds[0]],
  );
  const visit = (
    await db.query(
      "INSERT INTO queue_entries(clinic_id,doctor_id,patient_id,queue_date,token_number,position_key,status) VALUES ($1,$2,$3,(now() AT TIME ZONE 'Asia/Kolkata')::date,1,1,'in_consultation') RETURNING id",
      [clinic.clinicId, clinic.doctorIds[0], patient],
    )
  ).rows[0].id;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:3000/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/doctor');
  await page.goto(`http://localhost:3000/doctor/patients/${patient}`);
  await page
    .getByLabel('Dictation', { exact: true })
    .fill('History: no fever. Plan: review the report.');
  await page.getByRole('button', { name: 'Arrange note', exact: true }).click();
  await page.getByText('Your original spoken or typed note').waitFor();
  if ((await page.locator('#f-history').inputValue()) !== 'no fever')
    throw Error('Source text changed');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Save and sign', exact: true }).click();
  await page.getByTestId('signed-notes').getByText('no fever', { exact: false }).waitFor();
  await page.getByLabel('Task type', { exact: true }).selectOption('instructions');
  await page
    .getByLabel('Requested item', { exact: true })
    .fill('Review the doctor-written instructions');
  await page
    .getByLabel('Due date and time (your device time)', { exact: true })
    .fill('2099-01-01T10:00');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await page.getByRole('button', { name: 'Mark received / prepared', exact: true }).waitFor();
  await page.goto('http://localhost:3000/doctor');
  await page.getByRole('button', { name: 'Review and finish visit', exact: true }).click();
  await page.getByText('Signed visit note recorded.', { exact: true }).waitFor();
  await page.getByText(/Review the doctor-written instructions/).waitFor();
  await page.screenshot({ path: '/tmp/sahayak-completion-checklist.png', fullPage: true });
  await page.getByRole('checkbox', { name: /I reviewed these items/ }).check();
  await page.getByRole('button', { name: 'Finish visit', exact: true }).click();
  await page
    .getByRole('heading', { name: 'Visit completion checklist' })
    .waitFor({ state: 'hidden' });
  if (
    (await db.query('SELECT status FROM queue_entries WHERE id=$1', [visit])).rows[0].status !==
    'done'
  )
    throw Error('Visit not finished');
  if (
    Number(
      (await db.query('SELECT count(*) FROM outbox WHERE clinic_id=$1', [clinic.clinicId])).rows[0]
        .count,
    )
  )
    throw Error('Unexpected outbound message');
  console.log(
    'Passed: source-preserving draft, doctor signing, task creation, completion checklist, and visit finish. No outbound messages.',
  );
} finally {
  await browser?.close();
  if (clinic) await dropTestClinic(db, clinic.clinicId);
  await db.end();
}
