import { test, expect } from '@playwright/test';
import { login, ensureAuth, parseCurrency, parsePercent } from './helpers';

test('Rebalancing: summary metrics are consistent', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard/strategy?tab=rebalancing', { waitUntil: 'networkidle' });
  await ensureAuth(page);
  await page.waitForLoadState('networkidle');

  const portfolioDriftCard = page.getByRole('heading', { name: /portfolio drift/i }).locator('..');
  const subDriftText = await portfolioDriftCard.getByText(/sub-portfolio/i).locator('..').locator('p').nth(1).innerText();
  const assetDriftText = await portfolioDriftCard.getByText(/asset/i).locator('..').locator('p').nth(1).innerText();

  const subDrift = parsePercent(subDriftText);
  const assetDrift = parsePercent(assetDriftText);

  expect(subDrift).toBeGreaterThanOrEqual(0);
  expect(assetDrift).toBeGreaterThanOrEqual(0);

  const magnitudeText = await page.getByRole('heading', { name: /magnitude of rebalance actions/i }).locator('..').locator('p').first().innerText();
  const magnitude = parseCurrency(magnitudeText);
  expect(Number.isFinite(magnitude)).toBe(true);
});
