import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('Tax Lots: not available (404 expected)', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard/activity/tax-lots', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/this page could not be found/i)).toBeVisible();
});
