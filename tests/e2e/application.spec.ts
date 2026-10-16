import { expect, test } from '@playwright/test';

test('same-origin API is served with its documented prefix', async ({ request }) => {
  const health = await request.get('/api/v1/health/live');
  expect(health.ok()).toBeTruthy();
  expect(await health.json()).toEqual({ status: 'ok', service: 'haen-api' });
  const missing = await request.get('/api/v1/not-found');
  expect(missing.status()).toBe(404);
  expect((await missing.json()).code).toBe('NOT_FOUND');
});
test('Chinese and English UI remain usable and preserve language', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('把世界，听近一点。');
  await expect(page.getByRole('status')).toHaveText('尚未播放');
  await expect(page.getByRole('searchbox', { name: '搜索电台' })).toBeVisible();
  await expect(page.locator('audio')).toHaveCount(0);
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'A wider world. A closer listen.',
  );
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveTitle('HAEN · Listen to the world.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
