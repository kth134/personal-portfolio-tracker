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

async function run() {
  if (!EMAIL || !PASSWORD) throw new Error('Missing RAINVEST_EMAIL/RAINVEST_PASSWORD');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await login(page);
  const links = await page.locator('a').evaluateAll((els) =>
    els.map((el) => ({ text: (el.textContent || '').trim(), href: (el as HTMLAnchorElement).href }))
      .filter((l) => l.text || l.href.includes('/dashboard'))
  );
  console.log(JSON.stringify(links, null, 2));
  await browser.close();
}

run().catch((err) => { console.error(err); process.exit(1); });
