import { test, expect } from '@playwright/test';
import { DB, login } from './helpers';

test('doctor verifies history, approves instructions, follows up and records payment', async ({
  page,
}) => {
  test.setTimeout(120000);
  const db = DB();
  await db.connect();
  let patient: string;
  try {
    const c = (await db.query("SELECT id FROM clinics WHERE slug='dr-sharma'")).rows[0].id;
    patient = (
      await db.query("SELECT id FROM patients WHERE clinic_id=$1 AND name LIKE 'Aarav%' LIMIT 1", [
        c,
      ])
    ).rows[0].id;
    const doctor = (
      await db.query("SELECT doctor_id FROM staff_users WHERE email='anil@demo.sahayak.in'")
    ).rows[0].doctor_id;
    await db.query(
      "INSERT INTO visit_notes(clinic_id,patient_id,doctor_id,transcript,status,signed_at,note) VALUES ($1,$2,$3,'Synthetic source transcript','signed',now(),$4)",
      [
        c,
        patient,
        doctor,
        {
          plan: 'Bring the source report to the next visit.',
          instructions: 'Contact the clinic to arrange review.',
        },
      ],
    );
  } finally {
    await db.end();
  }
  page.on('dialog', (d) => d.accept());
  await login(page, 'anil@demo.sahayak.in');
  await page.goto(`/doctor/patients/${patient}`);
  const care = page.locator('#care-workspace');
  await expect(care.getByText('verified active medicines', { exact: false })).toBeVisible();
  await care.getByText('Add patient information', { exact: true }).click();
  await care.getByLabel('Type of information').selectOption('medication');
  await care.getByLabel('Name', { exact: true }).fill('Synthetic recorded medicine');
  await care.getByLabel('Active ingredient', { exact: false }).fill('Example ingredient');
  await care.getByLabel('Dose stated by doctor').fill('As recorded in source');
  await care.getByLabel('How often').fill('As recorded in source');
  await care.getByLabel('Date of event').fill('2026-10-01');
  await care.getByRole('button', { name: 'Save patient information' }).click();
  await expect(care.getByRole('status')).toHaveText('Saved.');
  await care.getByText('Patient history and recorded changes', { exact: true }).click();
  const entry = care.locator('article').filter({ hasText: 'Synthetic recorded medicine' });
  await expect(entry).toContainText('2026-10-01');
  await entry.getByRole('button', { name: 'Confirm source checked' }).click();
  await expect(entry).toContainText('Doctor verified');
  await care.getByText('Instructions to give the patient', { exact: true }).click();
  await care.getByLabel('Signed source note').selectOption({ index: 1 });
  await care.getByRole('button', { name: 'Prepare instructions from note' }).click();
  await expect(care.getByLabel('Instructions draft')).toContainText('Bring the source report');
  await care.getByRole('button', { name: 'Approve instructions', exact: true }).click();
  await expect(care.getByRole('button', { name: 'Download approved instructions' })).toBeVisible();
  await care.getByText('Plan the next steps', { exact: true }).click();
  await care.getByLabel('Plan name').fill('Synthetic follow-up journey');
  await care
    .getByLabel('Responsible doctor', { exact: true })
    .selectOption({ label: 'Dr. Anil Sharma' });
  await care.getByLabel('Task', { exact: true }).fill('Check original report');
  await care
    .getByLabel('Approved wording for the patient')
    .fill('Please bring the report to the clinic.');
  await care.getByLabel('When (your device time)').fill('2026-10-01T10:00');
  await care.getByRole('button', { name: 'Save plan for review' }).click();
  const plan = care.locator('article').filter({ hasText: 'Synthetic follow-up journey' });
  await plan.getByRole('button', { name: 'Approve plan', exact: true }).click();
  await plan.getByRole('button', { name: 'I contacted the patient' }).click();
  await plan
    .getByLabel('Patient reply or doctor’s review')
    .fill('Report received and reviewed by doctor.');
  await plan.getByRole('button', { name: 'Record review and finish step' }).click();
  await plan.getByRole('button', { name: 'Close completed plan' }).click();
  await expect(plan.getByRole('heading')).toContainText('Completed');
  await care.getByText('Clinic charges and payments', { exact: true }).click();
  await care.getByLabel('Charge description').fill('Synthetic consultation charge');
  await care.getByLabel('Charge amount (INR)').fill('100');
  await care.getByRole('button', { name: 'Record charge', exact: true }).click();
  const charge = care.locator('article').filter({ hasText: 'Synthetic consultation charge' });
  await charge.getByLabel('Payment received (INR)').fill('70');
  await charge.getByRole('button', { name: 'Record payment received' }).click();
  await expect(charge).toContainText('Outstanding ₹30.00');
  await page.reload();
  await care.getByText('Clinic charges and payments', { exact: true }).click();
  await expect(charge).toContainText('Recorded paid ₹70.00');
  await page.goto('/doctor/practice');
  await expect(page.getByRole('heading', { name: 'Clinic overview' })).toBeVisible();
  await expect(page.getByText(/Collected in this period/)).toContainText('70.00');
});

test('doctor keeps a reviewed reading list without sending patient data', async ({ page }) => {
  await login(page, 'anil@demo.sahayak.in');
  await page.goto('/doctor/references');
  await expect(page.getByRole('button', { name: 'Find publications' })).toBeDisabled();
  await page.getByText('Add a reviewed reference', { exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Synthetic reading list reference');
  await page.getByLabel('Original source link').fill('https://pubmed.ncbi.nlm.nih.gov/');
  await page.getByLabel('Publication date', { exact: true }).fill('2026-09-01');
  await page.getByLabel('Review again on').fill('2027-01-01');
  await page.getByLabel('Your evidence notes').fill('Synthetic review note; not clinical advice.');
  await page.getByRole('button', { name: 'Save reviewed reference' }).click();
  await expect(
    page.locator('article').filter({ hasText: 'Synthetic reading list reference' }),
  ).toContainText('Published 2026-09-01');
  await page.reload();
  await expect(page.getByRole('link', { name: 'Synthetic reading list reference' })).toBeVisible();
});
