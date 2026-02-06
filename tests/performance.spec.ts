import { test, expect } from '@playwright/test';
import { login, getMetricValue, parseCurrency, expectClose } from './helpers';

test('Performance: metrics are internally consistent', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard/performance?tab=data', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: /performance/i })).toBeVisible();

  await expect.poll(async () => {
    const netText = await getMetricValue(page, /net gain\/loss/i);
    return netText.includes('Loading');
  }, { timeout: 30000 }).toBe(false);

  const netText = await getMetricValue(page, /net gain\/loss/i);
  const unrealizedText = await getMetricValue(page, /unrealized g\/l/i);
  const realizedText = await getMetricValue(page, /realized g\/l/i);
  const incomeText = await getMetricValue(page, /income/i);

  const net = parseCurrency(netText);
  const unrealized = parseCurrency(unrealizedText);
  const realized = parseCurrency(realizedText);
  const income = parseCurrency(incomeText);

  expectClose(net, unrealized + realized + income, 5);
});
