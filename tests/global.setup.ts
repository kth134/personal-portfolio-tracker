import { chromium } from '@playwright/test';

const BASE_URL = 'https://rainvest.xyz';

async function globalSetup() {
  const email = process.env.RAINVEST_EMAIL || '';
  const password = process.env.RAINVEST_PASSWORD || '';
  if (!email || !password) throw new Error('Missing RAINVEST_EMAIL/RAINVEST_PASSWORD');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle' });
  const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]');
  if (await emailInput.count()) {
    await emailInput.first().fill(email);
    const passwordInput = page.locator('input[type="password"], input[name="password"], input[placeholder*="password" i]');
    await passwordInput.first().fill(password);
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    await page.waitForURL('**/dashboard**', { timeout: 60000 });
  }
  await page.context().storageState({ path: 'playwright/.auth/state.json' });
  await browser.close();
}

export default globalSetup;
