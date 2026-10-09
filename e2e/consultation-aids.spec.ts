import { test, expect } from '@playwright/test';
import { DB, login } from './helpers';

test('doctor selects reported symptoms and creates a reviewed prescription from chosen items', async ({
  page,
}) => {
  const db = DB();
  await db.connect();
  let patientId: string;
  try {
    patientId = (await db.query("SELECT id FROM patients WHERE name='Aarav Singh' LIMIT 1")).rows[0]
      .id;
    await db.query("UPDATE doctors SET registration_no='E2E-TEST' WHERE name='Dr. Anil Sharma'");
  } finally {
    await db.end();
  }
  page.on('dialog', (dialog) => dialog.accept());
  await login(page, 'anil@demo.sahayak.in');
  await page.goto(`/doctor/patients/${patientId}`);
  await page
    .getByRole('navigation', { name: 'Patient record sections' })
    .getByRole('link', { name: 'Visit', exact: true })
    .click();

  const composer = page.locator('#note-composer');
  await composer.getByText('Pick symptoms the patient reported').click();
  await composer.getByRole('button', { name: 'Fever', exact: true }).click();
  await composer.getByRole('button', { name: 'Headache', exact: true }).click();
  await composer.getByRole('button', { name: 'Add to note' }).click();
  await expect(composer.getByRole('textbox', { name: 'Dictation' })).toHaveValue(
    'Complaint: Fever, Headache',
  );
  await composer.getByRole('button', { name: 'Arrange note' }).click();
  await expect(composer.getByLabel('Complaint', { exact: true })).toHaveValue('Fever, Headache');
  await expect(composer.getByLabel('Diagnosis', { exact: true })).toHaveValue('');
  await composer.getByRole('button', { name: 'Save and sign' }).click();
  await expect(page.getByTestId('signed-notes')).toContainText('Fever, Headache');

  const issued = page.getByTestId('issued-docs');
  await issued.getByRole('button', { name: 'New prescription' }).click();
  await issued
    .getByRole('combobox', { name: 'Find a medicine by generic name' })
    .fill('Synthetic test medicine');
  await issued.getByRole('button', { name: 'Add to draft' }).click();
  await expect(issued.getByRole('button', { name: 'Create draft' })).toBeDisabled();
  const item = issued.getByRole('group', { name: '1. Synthetic test medicine' });
  await item.getByRole('textbox', { name: 'Dose *' }).fill('one test unit');
  await item.getByRole('textbox', { name: 'How often *' }).fill('once daily');
  await item.getByRole('textbox', { name: 'For how long *' }).fill('one day');
  await issued.getByRole('button', { name: 'Create draft' }).click();
  await expect(issued.getByTestId('doc-draft')).toContainText('Synthetic test medicine');
  await issued.getByTestId('doc-draft').getByRole('button', { name: 'Review and sign' }).click();
  await issued.getByLabel('Enter your password to sign').fill('demo1234');
  await issued
    .getByTestId('sign-dialog')
    .getByRole('button', { name: 'Sign', exact: true })
    .click();
  await expect(issued.getByTestId('doc-signed')).toContainText('RX-');
});
