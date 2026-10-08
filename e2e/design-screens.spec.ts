import { test, expect, type Page } from '@playwright/test';
import { DB, login } from './helpers';

// Exercise the real screens with seeded data at both supported layout sizes.
// No live messages, phone calls, or external services are triggered.
for (const width of [1440, 390]) {
  test(`designed screens render and remain within the viewport at ${width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(240000);
    await page.setViewportSize({ width, height: 960 });
    const db = DB();
    await db.connect();
    let patient: string;
    try {
      patient = (
        await db.query(
          "SELECT p.id FROM patients p JOIN clinics c ON p.clinic_id=c.id WHERE c.slug='dr-sharma' ORDER BY p.name LIMIT 1",
        )
      ).rows[0].id;
    } finally {
      await db.end();
    }
    async function capture(name: string, target: Page = page) {
      await expect(target.getByRole('heading').first()).toBeVisible();
      await expect(target.locator('body')).not.toContainText('Application error');
      const overflow = await target.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `${name} must not cause horizontal page scrolling`).toBeLessThanOrEqual(2);
      await target.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
    }
    await login(page, 'anil@demo.sahayak.in');
    for (const [name, route] of Object.entries({
      today: '/doctor',
      attention: '/doctor/inbox',
      care: '/doctor/care',
      waitlist: '/doctor/waitlist',
      plans: '/doctor/templates',
      overview: '/doctor/practice',
      references: '/doctor/references',
      settings: '/doctor/settings',
      integrations: '/doctor/integrations',
      safety: '/safety',
    })) {
      await page.goto(route);
      await expect(page.locator('.app-shell-content')).not.toBeEmpty();
      await expect(page.getByRole('heading').first()).toBeVisible();
      await capture(name);
    }
    await page.goto('/doctor/agents');
    for (const name of ['My assistants', 'WhatsApp', 'Phone calls', 'Reminders & updates']) {
      // A doctor sees a personal view with fewer tabs; the clinic-wide tabs belong to the admin view.
      if (!(await page.getByRole('button', { name, exact: true }).count())) continue;
      await page.getByRole('button', { name, exact: true }).click();
      if (name === 'WhatsApp' || name === 'Phone calls')
        await expect(page.getByText('Refresh status', { exact: true })).toBeVisible();
      await capture(name.replaceAll(' ', '-'));
    }
    await page.goto(`/doctor/patients/${patient}`);
    await expect(page.getByRole('navigation', { name: 'Patient record sections' })).toBeVisible();
    for (const name of ['Overview', 'Visit', 'Care plan', 'Records', 'Documents & billing']) {
      await page
        .getByRole('navigation', { name: 'Patient record sections' })
        .getByRole('link', { name, exact: true })
        .click();
      const sections: Record<string, string> = {
        Overview: 'overview',
        Visit: 'visit',
        'Care plan': 'care',
        Records: 'records',
        'Documents & billing': 'admin',
      };
      await expect(page.locator('.patient-page')).toHaveAttribute(
        'data-patient-view',
        sections[name],
      );
      await expect(page.locator('#note-composer')).toBeVisible({ visible: name === 'Visit' });
      await expect(page.locator('#patient-overview')).toBeVisible({ visible: name === 'Overview' });
      await capture(`patient-${name.replaceAll(' ', '-')}`);
    }
    // The setup steps are admin-only and the demo clinic has no admin login; flows.spec.ts walks them after signup.
    await login(page, 'reception@demo.sahayak.in');
    await capture('reception');
    await page.goto('/console#conversations');
    await expect(page.locator('#conversations')).toBeVisible();
    await capture('conversations');
    await page.goto('/console/privacy');
    await expect(page.getByRole('button', { name: 'Find patient' })).toBeVisible();
    await capture('privacy');
    for (const [name, route] of Object.entries({
      home: '/',
      login: '/login',
      signup: '/signup',
      public: '/c/dr-sharma',
      checkin: '/c/dr-sharma/checkin',
      tv: '/c/dr-sharma/tv',
      poster: '/c/dr-sharma/poster',
      practice: '/c/dr-sharma/sim',
      phone: '/c/dr-sharma/call',
    })) {
      await page.goto(route);
      await expect(page.getByRole('heading').first()).toBeVisible();
      await capture(name);
    }
  });
}
