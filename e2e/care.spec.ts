import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('waiting list requires opt-in, saves the patient, and supports withdrawal', async ({
  page,
}) => {
  await login(page, 'anil@demo.sahayak.in');
  await page.goto('/doctor/waitlist');
  await page.getByRole('button', { name: 'Add patient', exact: true }).click();
  await page.getByLabel('Find patient', { exact: true }).fill('Aarav');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByLabel('Patient', { exact: true }).locator('option')).toHaveCount(2);
  await page.getByLabel('Patient', { exact: true }).selectOption({ index: 1 });
  await page.getByLabel('Doctor', { exact: true }).selectOption({ label: 'Dr. Anil Sharma' });
  const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await page.getByLabel('From date').fill(date);
  await page.getByLabel('Through date').fill(date);
  await expect(page.getByRole('button', { name: 'Add to waiting list' })).toBeDisabled();
  await page
    .getByLabel('The patient explicitly agreed to receive cancellation-slot offers.')
    .check();
  await page.getByRole('button', { name: 'Add to waiting list' }).click();
  await expect(page.getByRole('status')).toHaveText('Added to waiting list.');
  await page.reload();
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await expect(page.getByText('No waiting patients.')).toBeVisible();
});

test('care task persists and progresses through doctor review to patient informed', async ({
  page,
}) => {
  await login(page, 'anil@demo.sahayak.in');
  await page.getByRole('link', { name: 'Find patient', exact: true }).click();
  await page.getByLabel('Find a patient').fill('Aarav');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('link', { name: /Aarav/ }).click();
  await page
    .getByRole('navigation', { name: 'Patient record sections' })
    .getByRole('link', { name: 'Care plan', exact: true })
    .click();
  await page.getByLabel('Task type', { exact: true }).selectOption('referral');
  await page.getByLabel('Requested item').fill('Synthetic referral follow-through');
  await page.getByLabel('Due date and time (your device time)').fill('2020-01-01T10:00');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  const task = page.locator('article').filter({ hasText: 'Synthetic referral follow-through' });
  await expect(task).toContainText('Overdue');
  await task.getByRole('button', { name: 'Mark received / prepared' }).click();
  await task.getByRole('button', { name: 'Confirm doctor review' }).click();
  await task.getByRole('button', { name: 'Confirm patient was informed' }).click();
  await expect(task.locator('.tag')).toHaveText('Patient informed');
  await page.reload();
  await expect(task.locator('.tag')).toHaveText('Patient informed');
  await expect(task).not.toContainText('Overdue');
});
