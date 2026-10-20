import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { first, install, selectStation } from './listening-fixture.js';

for (const [width, height] of [
  [1440, 900],
  [390, 844],
  [320, 700],
] as const) {
  test(`enters exploration from the welcome screen at ${width}x${height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    await install(page);
    await page.addInitScript(() => {
      sessionStorage.removeItem('haen:exploring:v1');
      localStorage.setItem('haen:language:v1', 'zh');
    });
    await page.goto('/');
    const browse = page.getByRole('button', { name: '先逛逛星图', exact: true });
    await expect(browse).toBeVisible();
    await expect(page.locator('header').getByText('嗯，听听世界。', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '开始收听', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: '查找电台', exact: true })).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page.getByTestId('globe-panel')).toHaveAttribute(
      'data-state',
      /^(ready|unavailable)$/,
    );
    await page.screenshot({ path: info.outputPath('welcome.png') });
    await browse.click();
    await expect(browse).toHaveCount(0);
    await expect(page.getByRole('button', { name: '查找电台', exact: true })).toBeVisible();
    await selectStation(page, first.name);
    await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await expect(page.getByRole('status')).toHaveAttribute('data-state', 'paused');
  });
}

test('starts listening directly from the welcome action', async ({ page }) => {
  await install(page);
  await page.addInitScript(() => {
    sessionStorage.removeItem('haen:exploring:v1');
    localStorage.setItem('haen:language:v1', 'zh');
  });
  await page.goto('/');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: '开始收听', exact: true }).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
  await expect(page.getByRole('button', { name: '先逛逛星图', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '查找电台', exact: true })).toBeVisible();
});
