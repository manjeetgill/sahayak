import { test, expect } from '@playwright/test';
for (const kind of ['solo', 'hospital'])
  test(`doctor presentation runs, pauses for review and saves ${kind} feedback`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    page.setDefaultTimeout(15000);
    await page.goto('/demo/present');
    await expect(page.getByRole('button', { name: 'Turn on narration', exact: true })).toBeVisible();
    await page.evaluate(() =>
      localStorage.setItem(
        'sahayak.session',
        JSON.stringify({ token: 'existing-clinic-login', user: { name: 'Existing user' } }),
      ),
    );
    await page.getByRole('combobox', { name: 'Clinic view', exact: true }).selectOption(kind);
    await page.getByLabel('Use fictional consent').check();
    await page.getByRole('button', { name: 'Prepare the demo', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Play demo', exact: true })).toBeEnabled();
    await page.getByRole('combobox', { name: 'Speed', exact: true }).selectOption('250');
    await page.getByRole('button', { name: 'Next step →', exact: true }).click();
    await expect(
      page.getByRole('region', { name: 'Patient view' }).getByText(/Welcome to DEMO/),
    ).toBeVisible();
    await expect(page.getByText('1 / 20 steps saved', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Play demo', exact: true }).click();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Next step →', exact: true })).toBeEnabled();
    const paused = await page.evaluate(
      () => JSON.parse(sessionStorage.getItem('sahayak.demo.presentation.v2')!).cursor,
    );
    await page.waitForTimeout(500);
    expect(
      await page.evaluate(
        () => JSON.parse(sessionStorage.getItem('sahayak.demo.presentation.v2')!).cursor,
      ),
    ).toBe(paused);
    await page.getByRole('button', { name: 'Play demo', exact: true }).click();
    const approval = page.getByRole('button', {
      name: 'Approve practice note & continue',
      exact: true,
    });
    await expect(approval).toBeVisible({ timeout: 45000 });
    await expect(approval).toBeDisabled();
    await expect(page.getByText('14 / 20 steps saved', { exact: true })).toBeVisible();
    await expect(page.getByText('Doctor’s draft — review needed')).toBeVisible();
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem('sahayak.session')!).token),
    ).toBe('existing-clinic-login');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Turn on narration', exact: true })).toBeVisible();
    await expect(page.getByText('14 / 20 steps saved', { exact: true })).toBeVisible();
    await expect(approval).toBeDisabled();
    await page.getByRole('combobox', { name: 'Speed', exact: true }).selectOption('250');
    await page.getByLabel('I have reviewed this fictional note').check();
    await approval.click();
    await expect(page.getByText('20 / 20 steps saved', { exact: true })).toBeVisible({
      timeout: 45000,
    });
    await expect(
      page.getByText('Assigned to the doctor — awaiting follow-up', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Signed consultation note', { exact: true })).toBeVisible();
    const result = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem('sahayak.demo.presentation.v2')!),
    );
    expect(result.data.appointment.status).toBe('completed');
    expect(result.data.queue.status).toBe('done');
    expect(result.data.feedback.work_status).toBe('assigned');
    expect(result.data.response.recovery).toBe('callback');
    expect(result.data.arrival.waiting_answer).toContain('understand what happens');
    expect(result.documentPath).toContain('/my-visit#');
    const patientCopy = await page.context().newPage();
    await patientCopy.goto(result.documentPath);
    await expect(
      patientCopy.getByRole('heading', { name: 'Your approved visit instructions' }),
    ).toBeVisible();
    await expect(
      patientCopy.getByRole('region', { name: 'Approved visit instructions' }),
    ).toContainText('Contact the clinic if you need clarification');
    await expect(patientCopy.getByRole('button', { name: 'Print / save as PDF' })).toBeVisible();
    await patientCopy.close();

    await page.screenshot({
      path: `/private/tmp/sahayak-presentation-${kind}.png`,
      fullPage: true,
    });
    if (kind === 'solo') {
      await page.setViewportSize({ width: 390, height: 844 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      ).toBe(true);
    }
  });
