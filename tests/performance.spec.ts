import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('Performance: page structure loads', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard/performance?tab=data', { waitUntil: 'networkidle' });

  await expect(page.getByRole('heading', { name: /performance/i })).toBeVisible();
  await expect(page.getByText(/portfolio performance summary/i)).toBeVisible();
  await expect(page.getByText(/net gain\/loss/i).first()).toBeVisible();
  await expect(page.getByText(/total return %/i).first()).toBeVisible();
  await expect(page.getByText(/annualized irr/i).first()).toBeVisible();
});
