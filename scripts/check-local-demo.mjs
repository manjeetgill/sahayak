/* global sessionStorage */
import console from 'node:console';
import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const [name, path] of [
    ['doctor', '/doctor'],
    ['admin', '/admin'],
    ['receptionist', '/console'],
  ]) {
    const context = await browser.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const page = await context.newPage();
      await page.goto('/demo');
      await page.getByRole('button', { name: 'Clinic or small hospital', exact: true }).click();
      await page.getByRole('button', { name: `Open ${name} view`, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(path + '$'));
      await expect(page.getByRole('heading').first()).toBeVisible();
      console.log(`${name} demo sign-in and workspace: passed`);
    } finally {
      await context.close();
    }
  }
  const context = await browser.newContext({ baseURL: 'http://localhost:3000' });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    await page.goto('/demo/present');
    await expect(page.getByRole('button', { name: 'Turn on narration', exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: 'Clinic view', exact: true }).selectOption('hospital');
    await page.getByLabel('Use fictional consent').check();
    await page.getByRole('button', { name: 'Prepare the demo', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Play demo', exact: true })).toBeEnabled();
    await page.getByRole('combobox', { name: 'Speed', exact: true }).selectOption('250');
    await page.getByRole('button', { name: 'Play demo', exact: true }).click();
    const approve = page.getByRole('button', {
      name: 'Approve practice note & continue',
      exact: true,
    });
    await expect(approve).toBeVisible({ timeout: 120000 });
    await expect(approve).toBeDisabled();
    await page.getByLabel('I have reviewed this fictional note').check();
    await approve.click();
    await expect(page.getByText('20 / 20 steps saved', { exact: true })).toBeVisible({
      timeout: 120000,
    });
    const state = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem('sahayak.demo.presentation.v2')),
    );
    expect(state.data.appointment.status).toBe('completed');
    expect(state.data.queue.status).toBe('done');
    expect(state.data.feedback.work_status).toBe('assigned');
    console.log(
      'Local booking → arrival → payment record → queue → signed note → feedback → assigned follow-up: passed',
    );
  } finally {
    await context.close();
  }
} finally {
  await browser.close();
}
