import { defineConfig } from '@playwright/test';

const apiPort = process.env.E2E_API_PORT ?? '4100';
const webPort = process.env.E2E_WEB_PORT ?? '3100';
const apiURL = `http://127.0.0.1:${apiPort}`;
const webURL = `http://127.0.0.1:${webPort}`;

// Uses the locally installed Google Chrome so no browser download is needed.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: webURL,
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm dev:api',
      url: `${apiURL}/health`,
      reuseExistingServer: false,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
      timeout: 60_000,
      env: {
        JOBS_ENABLED: 'false',
        API_PORT: apiPort,
        SIGNUP_INVITE_CODE: 'e2e-invite',
        SIGNUP_RATE_LIMIT: '100',
      },
    },
    {
      command: `pnpm --filter @sahayak/web exec next dev -p ${webPort}`,
      url: webURL,
      reuseExistingServer: false,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
      timeout: 90_000,
      env: { NEXT_PUBLIC_API_URL: apiURL, INTERNAL_API_URL: apiURL, NEXT_DIST_DIR: '.next-e2e' },
    },
  ],
});
