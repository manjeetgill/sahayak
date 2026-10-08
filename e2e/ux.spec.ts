import { test, expect } from '@playwright/test';
import { login } from './helpers';

const API = `http://127.0.0.1:${process.env.E2E_API_PORT ?? '4100'}`;

async function checkIn(request: any, name: string, phone: string) {
  const info = await (await request.get(`${API}/public/dr-sharma`)).json();
  const r = await request.post(`${API}/public/dr-sharma/checkin`, {
    data: {
      name,
      phone,
      doctorId: info.doctors[0].id,
      language: 'en',
      consent: { visit_data: true },
    },
  });
  expect(r.ok()).toBeTruthy();
}

test('doctor Today: the patient in the room comes first, with one main action', async ({
  page,
  request,
}) => {
  await checkIn(request, 'Ux Patient', '9822211101');
  await login(page, 'anil@demo.sahayak.in');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    /Good (morning|afternoon|evening), Dr\. Anil/,
  );
  await page.getByRole('button', { name: /Next patient/ }).click();
  const card = page.getByTestId('patient-card');
  await expect(card).toContainText('Ux Patient');
  await expect(card).toContainText('Now seeing');
  // the patient card sits above the attention panel (an empty attention panel no longer pushes it down)
  const cardTop = (await card.boundingBox())!.y;
  const attentionTop = (await page.locator('.attention-summary').boundingBox())!.y;
  expect(cardTop).toBeLessThan(attentionTop);
  await expect(page.locator('.attention-clear')).toContainText('Nothing needs your attention.');
  // one filled action; the rest are behind "More"
  await expect(card.getByRole('button', { name: 'Patient is here' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Skip' })).toBeHidden();
  await card.getByText('More', { exact: true }).click();
  await expect(card.getByRole('button', { name: 'Skip' })).toBeVisible();
});

test('the Visit tab holds the note AND prescriptions and certificates, and dictation is the main button', async ({
  page,
  request,
}) => {
  await checkIn(request, 'Visit Patient', '9822211102');
  await login(page, 'anil@demo.sahayak.in');
  await page.getByRole('button', { name: /Next patient/ }).click();
  const started = page.waitForResponse((r) => /\/queue\/.+\/start/.test(r.url()));
  await page.getByRole('button', { name: 'Patient is here' }).click();
  const resp = await started;
  expect(resp.status(), await resp.text()).toBe(200);
  await page.getByRole('link', { name: /Open record and write note/ }).click();
  await expect(page.getByTestId('note-composer')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New prescription' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New sick-leave certificate' })).toBeVisible();
  // an empty "check-in responses" panel no longer takes the side of the screen
  await expect(page.getByText('Earlier check-in responses')).toBeVisible();
  await expect(page.getByRole('button', { name: /Dictate/ })).not.toHaveClass(/ghost/);
});

test('Hindi toggle on the everyday screens, and a real Help page', async ({ page }) => {
  await login(page, 'anil@demo.sahayak.in');
  await page.getByRole('button', { name: 'हिन्दी में बदलें' }).click();
  await expect(page.getByRole('link', { name: 'आज' }).first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    /सुप्रभात|नमस्कार|शुभ संध्या/,
  );
  await page.getByRole('button', { name: 'Switch to English' }).click();
  await expect(page.getByRole('link', { name: 'Today' }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Help' }).click();
  await expect(page.getByRole('heading', { name: /How do I/ })).toBeVisible();
  await expect(page.getByTestId('help-list')).toContainText('Write a visit note');
});

test('reception: the "Ask your clinic" box is a usable width', async ({ page }) => {
  await login(page, 'reception@demo.sahayak.in');
  const box = await page.getByLabel('Ask your clinic').boundingBox();
  expect(box!.width).toBeGreaterThan(180);
});

test('a doctor never sees a greyed-out "Admin access needed" button', async ({ page }) => {
  await login(page, 'anil@demo.sahayak.in');
  await page.getByRole('link', { name: 'My assistants' }).first().click();
  await expect(page.getByRole('heading', { name: /little help/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Admin access needed' })).toHaveCount(0);
});

test('patient check-in step 1 has a labelled button', async ({ page }) => {
  await page.goto('/c/dr-sharma/checkin');
  await expect(page.getByRole('button', { name: /Continue/ })).toBeVisible();
});

test('visit shortcuts: templates, blanks check, favourite medicines, and the note draft survives a reload', async ({
  page,
  request,
}) => {
  await checkIn(request, 'Shortcut Patient', '9822211103');
  await login(page, 'anil@demo.sahayak.in');
  await page.goto('/doctor/shortcuts');
  await page.getByRole('button', { name: 'Add three starter templates' }).click();
  await expect(page.getByTestId('templates')).toContainText('Fever');
  await page.getByLabel('Medicine line').fill('tab paracetamol 500 mg twice a day for 3 days');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId('medicines')).toContainText(
    'tab paracetamol 500 mg twice a day for 3 days',
  );

  await page.goto('/doctor');
  await page.getByRole('button', { name: /Next patient/ }).click();
  const started = page.waitForResponse((r) => /\/queue\/.+\/start/.test(r.url()));
  await page.getByRole('button', { name: 'Patient is here' }).click();
  const resp = await started;
  expect(resp.status(), await resp.text()).toBe(200);
  await page.getByRole('link', { name: /Open record and write note/ }).click();
  await page.getByRole('button', { name: 'Fever', exact: true }).click();
  await expect(page.getByLabel('Dictation', { exact: true })).toHaveValue(
    /Complaint: fever for ___ days/,
  );
  // blanks must be filled before the assistant arranges anything
  await page.getByRole('button', { name: 'Arrange note' }).click();
  await expect(page.locator('.error')).toContainText('Fill in or delete the blanks');
  // what was typed survives a reload (weak connections, closed tabs)
  await page
    .getByLabel('Dictation', { exact: true })
    .fill('Complaint: fever for 2 days. Plan: review if worse');
  await page.reload();
  await expect(page.getByLabel('Dictation', { exact: true })).toHaveValue(/fever for 2 days/);
  await expect(page.getByText('Restored what you had typed before')).toBeVisible();

  // favourite medicine is one tap in the prescription box
  await page.getByRole('button', { name: 'New prescription' }).click();
  await page
    .getByRole('button', { name: '+ tab paracetamol 500 mg twice a day for 3 days' })
    .click();
  await expect(page.getByLabel(/Medicines, one per line/)).toHaveValue(
    'tab paracetamol 500 mg twice a day for 3 days',
  );
  await page.getByRole('button', { name: 'Repeat last prescription' }).click();
  await expect(page.locator('.error')).toContainText('no signed prescription to repeat');
});

test('reception imports a patient list: preview, no messages, first check-in asks for consent', async ({
  page,
  request,
}) => {
  await login(page, 'reception@demo.sahayak.in');
  await page.goto('/console/import');
  const csv =
    'Name,Phone,Age,Language\nImport One,9811100001,35,Hindi\nBad Row,12,,\nImport Two,9811100002,,\n';
  await page.setInputFiles('#csv', {
    name: 'patients.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await expect(page.getByTestId('import-preview')).toContainText('2 new');
  await expect(page.getByTestId('import-preview')).toContainText('Phone number is not valid');
  await page.getByRole('button', { name: /Import 2 patients/ }).click();
  await expect(page.getByTestId('import-done')).toContainText('Nobody was messaged');
  // the imported patient is asked for consent like a new patient
  const look = await (
    await request.post(`${API}/public/dr-sharma/lookup`, { data: { phone: '9811100001' } })
  ).json();
  expect(look.returning).toBe(false);
  await page.getByRole('button', { name: 'Undo this import' }).click();
  await expect(page.getByText('Undone: 2 removed.')).toBeVisible();
});

test('doctor marks themselves away; the share kit shows links and sources; the app is installable', async ({
  page,
  request,
}) => {
  await login(page, 'anil@demo.sahayak.in');
  await page.goto('/doctor/away');
  const d = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
  await page.getByLabel('From').fill(d);
  await page.getByRole('button', { name: 'Mark as away' }).click();
  await expect(page.getByText('Planned time away')).toBeVisible();
  await expect(page.getByTestId('away')).toContainText(d);
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByTestId('away')).not.toContainText(d);

  await page.goto('/doctor/share');
  await expect(page.getByTestId('share-kit')).toContainText('?src=whatsapp');
  await request.post(`${API}/public/dr-sharma/checkin`, {
    data: {
      name: 'Src Patient',
      phone: '9811100003',
      doctorId: (await (await request.get(`${API}/public/dr-sharma`)).json()).doctors[0].id,
      language: 'en',
      source: 'instagram',
      consent: { visit_data: true },
    },
  });
  await page.reload();
  await expect(page.getByTestId('sources')).toContainText('instagram');

  const m = await page.request.get('/manifest.webmanifest');
  expect(m.ok()).toBeTruthy();
  expect((await m.json()).display).toBe('standalone');
});
