import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  globalSetup: './tests/global.setup.ts',
  use: {
    baseURL: 'https://rainvest.xyz',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    storageState: 'playwright/.auth/state.json',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
