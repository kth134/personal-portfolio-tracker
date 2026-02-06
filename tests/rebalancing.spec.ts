import { test, expect } from '@playwright/test';
import { login, ensureAuth } from './helpers';

test('Rebalancing: page structure loads', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard/strategy?tab=rebalancing', { waitUntil: 'networkidle' });
  await ensureAuth(page);
  await page.waitForLoadState('networkidle');
  await expect(await page.locator('input[type="email"]').count()).toBe(0);
});
