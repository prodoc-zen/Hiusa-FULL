import { defineConfig, devices } from '@playwright/test';
import process from 'node:process';

export default defineConfig({
  testDir: './e2e',

  fullyParallel: false,

  retries: process.env.CI ? 2 : 0,

  workers: 1,

  reporter: process.env.CI ? 'line' : 'html',

  timeout: 30_000,

  use: {
    baseURL: 'http://127.0.0.1:5173',
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
    command: 'npm run dev -- --host 127.0.0.1 --port 5173',
    cwd: '.',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
