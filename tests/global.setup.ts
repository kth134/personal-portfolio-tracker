import { chromium } from '@playwright/test';

const BASE_URL = 'https://rainvest.xyz';

async function globalSetup() {
  const email = process.env.RAINVEST_EMAIL || '';
  const password = process.env.RAINVEST_PASSWORD || '';
  if (!email || !password) throw new Error('Missing RAINVEST_EMAIL/RAINVEST_PASSWORD');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL: BASE_URL,
    storageState: { cookies: [], origins: [] },
  });

  const page = await context.newPage();
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  const emailInput = page.locator('input#email');
  const passwordInput = page.locator('input#password');
  await emailInput.waitFor({ state: 'visible', timeout: 30000 });
  await emailInput.fill(email);
  await passwordInput.fill(password);
  await page.getByRole('button', { name: /log in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 60000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  await context.storageState({ path: 'playwright/.auth/state.json' });
  await browser.close();
}

export default globalSetup;
