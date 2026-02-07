import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('Performance Reports: page structure loads', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard/performance?tab=reports', { waitUntil: 'networkidle' });

  await expect(page.getByRole('heading', { name: /performance/i })).toBeVisible();
  await expect(page.getByText(/mwr \/ twr performance/i)).toBeVisible();
  await expect(page.getByText(/net gain/i).first()).toBeVisible();
  await expect(page.getByText(/income/i).first()).toBeVisible();
  await expect(page.getByText(/realized/i).first()).toBeVisible();
  await expect(page.getByText(/unrealized/i).first()).toBeVisible();
});
