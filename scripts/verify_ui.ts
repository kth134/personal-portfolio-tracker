import { chromium, type Page } from '@playwright/test';

const BASE_URL = 'https://rainvest.xyz';
const LOGIN_EMAIL = process.env.RAINVEST_EMAIL || '';
const LOGIN_PASSWORD = process.env.RAINVEST_PASSWORD || '';
const LOGIN_PATH = process.env.RAINVEST_LOGIN_PATH || '/dashboard';

async function login(page: Page) {
  await page.goto(`${BASE_URL}${LOGIN_PATH}`, { waitUntil: 'networkidle' });
  const email = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]');
  const password = page.locator('input[type="password"], input[name="password"], input[placeholder*="password" i]');
  if (await email.first().count()) {
    await email.first().fill(LOGIN_EMAIL);
    await password.first().fill(LOGIN_PASSWORD);
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    await page.waitForURL('**/dashboard**', { timeout: 60000 });
  }
}

async function verifyRebalancing(page: Page) {
  await page.goto(`${BASE_URL}/dashboard/strategy/rebalancing`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'tmp-rebalancing.png', fullPage: true });

  const heading = page.getByRole('heading', { name: /tactical execution dashboard/i });
  if (await heading.count()) {
    await heading.first().waitFor({ timeout: 60000 });
  }

  const toggle = page.getByRole('switch').first();
  if (await toggle.count()) {
    await toggle.click();
    await page.waitForTimeout(1000);
  }
}

async function verifyHoldings(page: Page) {
  await page.goto(`${BASE_URL}/dashboard/portfolio`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'tmp-holdings.png', fullPage: true });
}

async function run() {
  if (!LOGIN_EMAIL || !LOGIN_PASSWORD) {
    throw new Error('Missing RAINVEST_EMAIL/RAINVEST_PASSWORD env vars');
  }
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await login(page);
  await verifyRebalancing(page);
  await verifyHoldings(page);
  await browser.close();
  console.log('UI verification complete');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
