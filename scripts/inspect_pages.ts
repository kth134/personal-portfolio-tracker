import { chromium } from '@playwright/test';

const BASE_URL = 'https://rainvest.xyz';
const EMAIL = process.env.RAINVEST_EMAIL || '';
const PASSWORD = process.env.RAINVEST_PASSWORD || '';

async function login(page: any) {
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle' });
  const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]');
  if (await emailInput.count()) {
    await emailInput.first().fill(EMAIL);
    const passwordInput = page.locator('input[type="password"], input[name="password"], input[placeholder*="password" i]');
    await passwordInput.first().fill(PASSWORD);
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    await page.waitForURL('**/dashboard**', { timeout: 60000 });
  }
}

async function inspect(path: string) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await login(page);
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  const title = await page.title();
  const h1 = await page.locator('h1').first().innerText().catch(() => '');
  const h2 = await page.locator('h2').first().innerText().catch(() => '');
  const labels = await page.locator('label').allInnerTexts();
  console.log(path, { title, h1, h2, url: page.url(), labels: labels.slice(0, 10) });
  await browser.close();
}

async function run() {
  if (!EMAIL || !PASSWORD) throw new Error('Missing RAINVEST_EMAIL/RAINVEST_PASSWORD');
  await inspect('/dashboard');
  await inspect('/dashboard/portfolio');
  await inspect('/dashboard/strategy?tab=rebalancing');
  await inspect('/dashboard/performance');
  await inspect('/dashboard/performance/reporting');
  await inspect('/dashboard/activity');
  await inspect('/dashboard/activity/tax-lots');
}

run().catch(err => { console.error(err); process.exit(1); });
