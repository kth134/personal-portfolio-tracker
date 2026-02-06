import { test, expect } from '@playwright/test';
import { login, ensureAuth } from './helpers';

test('Transactions: page structure loads', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard/activity?tab=transactions', { waitUntil: 'networkidle' });
  await ensureAuth(page);
  await page.waitForLoadState('networkidle');
  await expect(await page.locator('input[type="email"]').count()).toBe(0);
});
