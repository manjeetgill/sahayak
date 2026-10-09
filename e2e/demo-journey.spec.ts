import { test, expect } from '@playwright/test';
for (const kind of ['solo', 'hospital'])
  test(`same patient completes the ${kind} demonstration`, async ({ page }) => {
    test.setTimeout(120000);
    await page.goto('/demo/journey');
    await page.getByLabel('Clinic view').selectOption(kind);
    const step = async (label: string) => {
      const response = page.waitForResponse(
        (r) => r.url().includes('/staff/demo/journey') && r.request().method() === 'POST',
      );
      await page.getByRole('button', { name: label, exact: true }).click();
      const r = await response;
      expect(r.status(), await r.text()).toBe(200);
      return r.json();
    };
    const first = await step('Start a fresh rehearsal');
    const patient = first.patient.id;
    const booked = await step('Run booking conversation');
    expect(booked.patient.id).toBe(patient);
    expect(booked.appointment?.status).toBe('booked');
    const screen = await page.context().newPage();
    await screen.goto('/doctor');
    await expect(
      screen
        .getByRole('region', { name: 'Upcoming appointments' })
        .getByText('Demo Journey Patient'),
    ).toBeVisible();
    await screen.close();
    await page.getByLabel('For this fictional patient, demonstrate agreement').check();
    await step('Submit practice QR check-in');
    const paid = await step('Record practice cash and issue token');
    expect(paid.queue.status).toBe('waiting');
    const called = await step('Call this patient and start visit');
    expect(called.queue.status).toBe('in_consultation');
    await step('Save structured draft');
    await page.getByLabel('I reviewed the displayed draft').check();
    await step('Sign reviewed note');
    await step('Approve displayed instructions');
    const done = await step('Finish reviewed visit');
    expect(done.queue.status).toBe('done');
    expect(done.appointment.status).toBe('completed');
    expect(done.feedback).toBeTruthy();
    await step('Open private patient feedback form');
    const form = page.frameLocator('iframe');
    await form.getByLabel('Please contact me', { exact: true }).check();
    await form.getByLabel('Needs improvement', { exact: true }).check();
    await form
      .getByLabel('What should we improve, or what would you suggest? (optional)')
      .fill('DEMO: Please explain the next steps more clearly.');
    await form.getByRole('button', { name: 'Send my response', exact: true }).click();
    await expect(form.getByText('Thank you. Your response is saved.')).toBeVisible();
    await page.getByRole('button', { name: 'Refresh patient response', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Assign feedback to the doctor' })).toBeEnabled();
    const assigned = await step('Assign feedback to the doctor');
    expect(assigned.patient.id).toBe(patient);
    expect(assigned.response.recovery).toBe('callback');
    await page.screenshot({ path: `/private/tmp/sahayak-journey-${kind}.png`, fullPage: true });
  });
