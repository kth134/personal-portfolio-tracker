import { chromium } from '@playwright/test';

const BASE_URL = 'https://rainvest.xyz';
const EMAIL = process.env.RAINVEST_EMAIL || '';
const PASSWORD = process.env.RAINVEST_PASSWORD || '';
const PATH = process.env.RAINVEST_PATH || '/dashboard/portfolio';

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

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await login(page);
  await page.goto(`${BASE_URL}${PATH}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  console.log(PATH, '->', page.url());
  const h1 = await page.locator('h1').first().innerText().catch(() => '');
  const h2 = await page.locator('h2').first().innerText().catch(() => '');
  console.log('h1:', h1, 'h2:', h2);
  await browser.close();
}

run().catch(err => { console.error(err); process.exit(1); });
