import { test, expect } from '@playwright/test';
import { login, ensureAuth } from './helpers';

test('Rebalancing: page structure loads', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard/strategy?tab=rebalancing', { waitUntil: 'networkidle' });
  await ensureAuth(page);
  await page.waitForLoadState('networkidle');

  await expect(page.getByText(/tactical execution dashboard/i)).toBeVisible();
  await expect(page.getByText(/sub-portfolio drift/i)).toBeVisible();
  await expect(page.getByText(/asset drift/i)).toBeVisible();
});
