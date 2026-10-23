import { expect, test } from '@playwright/test';
import { install, openDirectory } from './listening-fixture.js';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
});

test('keeps search, filters and results together without moving the navigation', async ({
  page,
}, info) => {
  await install(page);
  await page.goto('/');
  for (const [width, height] of [
    [1440, 900],
    [768, 1024],
    [390, 844],
    [320, 700],
    [844, 390],
  ]) {
    await page.setViewportSize({ width: width!, height: height! });
    await openDirectory(page);
    const panel = page.locator('#station-directory');
    const search = panel.getByRole('searchbox');
    await expect(search).toBeFocused();
    await expect(page.locator('header').getByRole('searchbox')).toHaveCount(0);
    const field = await search.boundingBox();
    const surface = await panel.boundingBox();
    expect(field!.x).toBeGreaterThan(surface!.x);
    expect(field!.x + field!.width).toBeLessThan(surface!.x + surface!.width);
    expect(field!.y).toBeGreaterThan(surface!.y);
    const close = panel.getByRole('button', { name: '关闭面板', exact: true });
    await expect(close).toBeInViewport();
    if (width! < 768) {
      const closeBounds = (await close.boundingBox())!;
      const title = (await panel.getByRole('heading', { name: '探索电台' }).boundingBox())!;
      const inputRow = (await search.locator('..').boundingBox())!;
      expect(closeBounds.y + closeBounds.height).toBeLessThan(inputRow.y);
      expect(
        Math.abs(title.y + title.height / 2 - closeBounds.y - closeBounds.height / 2),
      ).toBeLessThan(2);
      expect(inputRow.width).toBeGreaterThan(surface!.width - 40);
      expect(closeBounds.width).toBeGreaterThanOrEqual(44);
      expect(closeBounds.height).toBeGreaterThanOrEqual(44);
    }
    const trigger = page.getByRole('button', { name: '查找电台', exact: true });
    const openBounds = await trigger.boundingBox();
    await panel.locator('summary').click();
    await expect(panel.getByRole('checkbox', { name: '爵士', exact: true })).toBeVisible();
    await panel.locator('summary').click();
    await page.screenshot({ path: info.outputPath(`search-${width}.png`), scale: 'css' });
    await trigger.click();
    await expect(panel).toHaveCount(0);
    expect(await trigger.boundingBox()).toEqual(openBounds);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

test('keeps IME composition open, clears in place and returns focus on Escape', async ({
  page,
}) => {
  await install(page);
  await page.goto('/');
  await openDirectory(page);
  const panel = page.locator('#station-directory');
  const search = panel.getByRole('searchbox');
  await search.dispatchEvent('compositionstart');
  await search.dispatchEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true });
  await expect(panel).toBeVisible();
  await search.dispatchEvent('compositionend');
  await search.fill('River');
  await expect(page.getByTestId('directory-state')).toHaveText('找到 1 个电台');
  await panel.getByRole('button', { name: '清除搜索', exact: true }).click();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');
  await expect(page.getByTestId('directory-state')).toHaveText('找到 3 个电台');
  await search.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('button', { name: '查找电台', exact: true })).toBeFocused();
});

test('keeps the search field and filter toggle separate from directory errors on narrow screens', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await install(page, false);
  await page.route('**/api/v1/stations?*', (route) =>
    route.fulfill({
      status: 503,
      json: { code: 'UNAVAILABLE', message: 'Unavailable', requestId: 'fixture' },
    }),
  );
  await page.goto('/');
  await openDirectory(page);
  const panel = page.locator('#station-directory');
  const retry = panel.getByRole('button', { name: '重试', exact: true });
  await expect(retry).toBeVisible();
  const error = await page.getByTestId('directory-state').boundingBox();
  const filters = await panel.locator('summary').boundingBox();
  expect(error!.y + error!.height).toBeLessThanOrEqual(filters!.y + 1);
  await expect(panel.getByRole('searchbox')).toBeInViewport();
});
