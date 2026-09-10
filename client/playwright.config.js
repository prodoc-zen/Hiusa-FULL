import { defineConfig, devices } from '@playwright/test';
import process from 'node:process';

const clientPort = process.env.HIUSA_E2E_CLIENT_PORT || '5173';
const baseURL = process.env.HIUSA_E2E_BASE_URL || `http://127.0.0.1:${clientPort}`;

export default defineConfig({
  testDir: './e2e',

  fullyParallel: false,

  retries: process.env.CI ? 2 : 0,

  workers: 1,

  reporter: process.env.CI ? 'line' : 'html',

  timeout: 30_000,

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${clientPort}`,
    cwd: '.',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
