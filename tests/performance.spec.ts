import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('Performance: data page loads; reporting 404 expected', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard/performance', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: /performance/i })).toBeVisible();

  await page.goto('/dashboard/performance/reporting', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/this page could not be found/i)).toBeVisible();
});
