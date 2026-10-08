import { test, expect } from '@playwright/test';
import { login } from './helpers';

const API = `http://127.0.0.1:${process.env.E2E_API_PORT ?? '4100'}`;

async function checkIn(request: any, name: string, phone: string) {
  const info = await (await request.get(`${API}/public/dr-sharma`)).json();
  const r = await request.post(`${API}/public/dr-sharma/checkin`, {
    data: { name, phone, doctorId: info.doctors[0].id, language: 'en', consent: { visit_data: true } },
  });
  expect(r.ok()).toBeTruthy();
}

test('doctor Today: the patient in the room comes first, with one main action', async ({ page, request }) => {
  await checkIn(request, 'Ux Patient', '9822211101');
  await login(page, 'anil@demo.sahayak.in');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Good (morning|afternoon|evening), Dr\. Anil/);
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

test('the Visit tab holds the note AND prescriptions and certificates, and dictation is the main button', async ({ page, request }) => {
  await checkIn(request, 'Visit Patient', '9822211102');
  await login(page, 'anil@demo.sahayak.in');
  await page.getByRole('button', { name: /Next patient/ }).click();
  await page.getByRole('button', { name: 'Patient is here' }).click();
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
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/सुप्रभात|नमस्कार|शुभ संध्या/);
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
