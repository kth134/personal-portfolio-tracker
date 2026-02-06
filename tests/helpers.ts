import { expect, type Page } from '@playwright/test';

export async function login(page: Page) {
  await page.goto('/dashboard', { waitUntil: 'networkidle' });
  await ensureAuth(page);
}

export async function dismissMfaPrompt(page: Page) {
  const mfaHeading = page.getByRole('heading', { name: /enhance your security/i });
  if (await mfaHeading.count()) {
    const notNow = page.getByRole('button', { name: /not now/i });
    if (await notNow.count()) await notNow.click();
  }
}

export async function ensureAuth(page: Page) {
  const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]');
  if (await emailInput.count()) {
    const email = process.env.RAINVEST_EMAIL || '';
    const password = process.env.RAINVEST_PASSWORD || '';
    if (!email || !password) throw new Error('Missing RAINVEST_EMAIL/RAINVEST_PASSWORD');
    await emailInput.first().fill(email);
    const passwordInput = page.locator('input[type="password"], input[name="password"], input[placeholder*="password" i]');
    await passwordInput.first().fill(password);
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    await page.waitForURL('**/dashboard**', { timeout: 120000 });
  }
  await dismissMfaPrompt(page);
}

export async function gotoAuthed(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'networkidle' });
  await ensureAuth(page);
}

export function parseCurrency(value: string) {
  const cleaned = value.replace(/[^0-9.-]/g, '');
  const parsed = Number(cleaned);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function parsePercent(value: string) {
  const cleaned = value.replace(/[^0-9.-]/g, '');
  const parsed = Number(cleaned);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function expectClose(actual: number, expected: number, tolerance = 1) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

export async function getMetricValue(page: Page, label: RegExp | string) {
  const labelLocator = page.getByText(label).first();
  await expect(labelLocator).toBeVisible();
  const valueLocator = labelLocator.locator('..').locator('p').first();
  const text = await valueLocator.innerText();
  return text.trim();
}

export async function expectPercentSumClose(values: number[], target = 100, tolerance = 1.0) {
  const sum = values.reduce((a, b) => a + b, 0);
  expect(Math.abs(sum - target)).toBeLessThanOrEqual(tolerance);
}
