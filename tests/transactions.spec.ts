import { test, expect } from '@playwright/test';
import { login, ensureAuth } from './helpers';

test('Transactions: page structure loads', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard', { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: /activity/i }).click();
  await ensureAuth(page);
  const dialog = page.getByRole('dialog');
  if (await dialog.count()) {
    await dialog.getByRole('link', { name: /transactions/i }).click();
  }
  await ensureAuth(page);
  await page.waitForLoadState('networkidle');
  await expect(await page.locator('input[type="email"]').count()).toBe(0);
});
