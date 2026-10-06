import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { DB, login } from './helpers';
test('clinic template becomes an editable patient draft; result and insurance reviews reach the inbox', async ({
  page,
}) => {
  test.setTimeout(90000);
  page.on('dialog', (d) => d.accept());
  const db = DB();
  await db.connect();
  let patient: string;
  try {
    const clinic = (await db.query("SELECT id FROM clinics WHERE slug='dr-sharma'")).rows[0].id;
    patient = (
      await db.query("SELECT id FROM patients WHERE clinic_id=$1 AND name LIKE 'Aarav%' LIMIT 1", [
        clinic,
      ])
    ).rows[0].id;
    const bytes = readFileSync('e2e/files/report.pdf');
    await db.query(
      "INSERT INTO patient_documents(clinic_id,patient_id,uploaded_via,filename,mime,size_bytes,data) VALUES($1,$2,'staff','local-review-source.pdf','application/pdf',$3,$4)",
      [clinic, patient, bytes.length, bytes],
    );
  } finally {
    await db.end();
  }
  await login(page, 'anil@demo.sahayak.in');
  await page.goto('/doctor/templates');
  await page.getByRole('button', { name: 'Create reusable plan', exact: true }).click();
  await page.getByLabel('Plan title', { exact: true }).fill('Reusable synthetic report plan');
  await page.getByLabel('Task name', { exact: true }).fill('Review original report');
  await page
    .getByLabel('Wording for the patient', { exact: true })
    .fill('Please bring your original report.');
  await page.getByLabel('Days after plan starts').fill('2');
  await page.getByRole('button', { name: 'Save version for review' }).click();
  const template = page.locator('article').filter({ hasText: 'Reusable synthetic report plan' });
  await template.getByRole('button', { name: 'Approve reusable plan' }).click();
  await expect(template).toContainText('Approved');
  await page.goto(`/doctor/patients/${patient}`);
  await page
    .getByRole('navigation', { name: 'Patient record sections' })
    .getByRole('link', { name: 'Care plan', exact: true })
    .click();
  const care = page.locator('#care-workspace');
  await care.getByText('Use a reusable clinic plan', { exact: true }).click();
  await care
    .getByLabel('Approved clinic plan', { exact: true })
    .selectOption({ label: 'Reusable synthetic report plan · version 1' });
  await care.getByLabel('Plan starts (your device time)').fill('2026-10-05T10:00');
  await care.getByLabel('Plan owner', { exact: true }).selectOption({ label: 'Dr. Anil Sharma' });
  await care.getByRole('button', { name: 'Create patient plan for review' }).click();
  await care.getByText('Plan the next steps', { exact: true }).click();
  const plan = care.locator('article').filter({ hasText: 'Reusable synthetic report plan' });
  await plan
    .getByLabel('Patient step wording')
    .fill('Bring the original report to your scheduled review.');
  await plan.getByRole('button', { name: 'Save patient step' }).click();
  await plan.getByRole('button', { name: 'Approve plan', exact: true }).click();
  await expect(plan.getByRole('button', { name: 'Pause plan' })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Patient record sections' })
    .getByRole('link', { name: 'Records', exact: true })
    .click();
  await care.getByText('Add patient information', { exact: true }).click();
  await care.getByLabel('Type of information').selectOption('lab');
  await care.getByLabel('Name', { exact: true }).fill('Synthetic outside-range value');
  await care.getByLabel('Result value').fill('5');
  await care.getByLabel('Unit as printed').fill('units');
  await care.getByLabel('Lower reference limit').fill('1');
  await care.getByLabel('Upper reference limit').fill('4');
  await care
    .getByLabel('Exact text from the report')
    .fill('Synthetic outside-range value 5 units, range 1–4');
  await care
    .getByLabel('Original report (required)')
    .selectOption({ label: 'local-review-source.pdf' });
  await care.getByLabel('I checked this information against the source.').check();
  await care.getByRole('button', { name: 'Save patient information' }).click();
  await page.goto('/doctor/inbox');
  await page.locator('select').nth(1).selectOption('result');
  await expect(
    page.getByTestId('inbox-item').filter({ hasText: 'Test result outside supplied report range' }),
  ).toBeVisible();
  await page.goto(`/doctor/patients/${patient}`);
  await page
    .getByRole('navigation', { name: 'Patient record sections' })
    .getByRole('link', { name: 'Records', exact: true })
    .click();
  await care.getByText('Record review of test results', { exact: true }).click();
  const result = care.getByLabel('Doctor’s result review').locator('xpath=ancestor::article[1]');
  await result
    .getByLabel('Doctor’s result review')
    .fill('Original report reviewed; next review arranged.');
  await result.getByRole('button', { name: 'Save doctor review' }).click();
  await expect(care.getByText('Review recorded:', { exact: false })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Patient record sections' })
    .getByRole('link', { name: 'Documents & billing', exact: true })
    .click();
  await care.getByText('Insurance and pre-authorization paperwork', { exact: true }).click();
  await care.getByLabel('Paperwork title').fill('Synthetic insurance case');
  await care
    .getByLabel('Paperwork owner', { exact: true })
    .selectOption({ label: 'Dr. Anil Sharma' });
  await care.getByLabel('Paperwork due (your device time)').fill('2026-10-01T10:00');
  await care.getByRole('button', { name: 'Add paperwork case' }).click();
  const insurance = care.locator('article').filter({ hasText: 'Synthetic insurance case' });
  await insurance
    .getByLabel('Correspondence or action recorded')
    .fill('Submitted outside the app using synthetic paperwork.');
  await insurance.getByRole('button', { name: 'Record Submitted', exact: true }).click();
  await expect(insurance.getByRole('heading')).toContainText('Submitted');
  await page
    .getByRole('navigation', { name: 'Patient record sections' })
    .getByRole('link', { name: 'Records', exact: true })
    .click();
  await care.getByText('Find facts and browse the full record', { exact: true }).click();
  await care.getByLabel('Question or recorded words').fill('show test results outside range');
  await care.getByRole('button', { name: 'Find recorded facts' }).click();
  await expect(care.getByText('Original recorded excerpts only.', { exact: false })).toBeVisible();
  await page.goto('/doctor/inbox');
  await page.locator('select').nth(1).selectOption('result');
  await expect(page.getByText('No outstanding items recorded.', { exact: false })).toBeVisible();
  await page.locator('select').nth(1).selectOption('insurance');
  await expect(
    page.getByTestId('inbox-item').filter({ hasText: 'Synthetic insurance case' }),
  ).toBeVisible();
});
