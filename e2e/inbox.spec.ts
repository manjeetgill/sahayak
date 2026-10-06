import { test, expect } from '@playwright/test';
import { DB, login } from './helpers';
test('doctor opens prioritised inbox and reads the original conversation', async ({ page }) => {
  const db = DB();
  await db.connect();
  try {
    const clinic = (await db.query("SELECT id FROM clinics WHERE slug='dr-sharma'")).rows[0].id;
    const patient = (
      await db.query('SELECT id FROM patients WHERE clinic_id=$1 ORDER BY created_at LIMIT 1', [
        clinic,
      ])
    ).rows[0].id;
    const conversation = (
      await db.query(
        "INSERT INTO conversations(clinic_id,patient_id,contact) VALUES ($1,$2,'+199900011234') RETURNING id",
        [clinic, patient],
      )
    ).rows[0].id;
    await db.query(
      "INSERT INTO messages(clinic_id,conversation_id,direction,sender,body) VALUES ($1,$2,'in','patient','Synthetic inbox source message')",
      [clinic, conversation],
    );
    await db.query(
      "INSERT INTO flags(clinic_id,conversation_id,patient_id,kind,severity,summary) VALUES ($1,$2,$3,'other','urgent','Synthetic urgent request')",
      [clinic, conversation, patient],
    );
    await login(page, 'anil@demo.sahayak.in');
    await page.getByRole('link', { name: /^View all/ }).click();
    await expect(
      page.getByRole('heading', { name: 'Needs my attention', exact: true }),
    ).toBeVisible();
    const item = page.getByTestId('inbox-item').filter({ hasText: 'Synthetic urgent request' });
    await expect(item).toContainText('Urgent');
    await expect(item.getByRole('button', { name: 'Remind me tomorrow' })).toBeDisabled();
    await item.getByRole('button', { name: 'Acknowledge', exact: true }).click();
    await expect(item).toContainText('Acknowledged');
    await item.getByLabel('Assign inbox owner').selectOption({ label: 'Dr. Anil Sharma' });
    await expect(item).toContainText('Inbox owner: Dr. Anil Sharma');
    await item.getByRole('button', { name: 'Read conversation' }).click();
    await expect(page.getByRole('region', { name: 'Source conversation' })).toContainText(
      'Synthetic inbox source message',
    );
    page.once('dialog', (d) => d.accept('Doctor reviewed the synthetic request.'));
    await item.getByRole('button', { name: 'Mark handled' }).click();
    await expect(
      page.getByTestId('inbox-item').filter({ hasText: 'Synthetic urgent request' }),
    ).toHaveCount(0);
  } finally {
    await db.end();
  }
});
