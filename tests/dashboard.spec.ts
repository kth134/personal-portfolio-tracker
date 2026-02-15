import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('Dashboard: page loads and shows key sections', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard', { waitUntil: 'networkidle' });

  await expect(page.getByRole('heading', { name: /portfolio dashboard/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /performance/i }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /portfolio construction/i }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /portfolio management/i }).first()).toBeVisible();
});
