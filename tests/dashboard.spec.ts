import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('Dashboard: loads and shows key summary cards', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard', { waitUntil: 'networkidle' });

  await expect(page.getByRole('heading', { name: /portfolio dashboard/i })).toBeVisible();
  await expect(await page.locator('input[type="email"]').count()).toBe(0);
});
