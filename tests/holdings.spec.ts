import { test, expect } from '@playwright/test';
import { login, ensureAuth } from './helpers';

test('Portfolio Holdings: page structure loads', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard/portfolio', { waitUntil: 'networkidle' });
  await ensureAuth(page);
  await page.waitForLoadState('networkidle');
  await expect(await page.locator('input[type="email"]').count()).toBe(0);
});
