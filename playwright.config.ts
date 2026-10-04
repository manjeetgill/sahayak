import { defineConfig } from '@playwright/test';

// Uses the locally installed Google Chrome so no browser download is needed.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm dev:api',
      url: 'http://127.0.0.1:4000/health',
      reuseExistingServer: true,
      timeout: 60_000,
      env: { JOBS_ENABLED: 'false', API_PORT: '4000' },
    },
    {
      command: 'pnpm dev:web',
      url: 'http://127.0.0.1:3000',
      reuseExistingServer: true,
      timeout: 90_000,
      env: { NEXT_PUBLIC_API_URL: 'http://127.0.0.1:4000' },
    },
  ],
});
