import { expect, test } from '@playwright/test';
import { first, install, openDirectory, selectStation } from './listening-fixture.js';

for (const [width, height] of [
  [1440, 900],
  [768, 1024],
  [390, 844],
  [320, 700],
  [844, 390],
] as const) {
  test(`keeps the listening screen fixed at ${width}x${height}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
    await install(page);
    await page.goto('/');
    await selectStation(page, first.name);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    const screenSize = () =>
      page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        scroll: scrollY,
      }));
    const initial = await screenSize();
    expect(initial.width).toBeLessThanOrEqual(initial.viewportWidth);
    expect(initial.height).toBeLessThanOrEqual(initial.viewportHeight);
    await page.mouse.move(width / 2, 10);
    await page.mouse.wheel(0, 1000);
    await page.evaluate(() => scrollTo(0, 1000));
    expect((await screenSize()).scroll).toBe(0);
    const heading = await page.getByRole('heading', { level: 1 }).boundingBox();
    const player = await page.getByRole('contentinfo').boundingBox();
    expect(heading!.y).toBeGreaterThanOrEqual(0);
    expect(heading!.y + heading!.height).toBeLessThanOrEqual(player!.y);
    expect(player!.y + player!.height).toBeLessThanOrEqual(height);
    await page.screenshot({ path: info.outputPath('listening-screen.png') });
    await openDirectory(page);
    const dialog = page.getByRole('dialog', { name: '探索电台', exact: true });
    await expect(page.getByRole('searchbox')).toBeFocused();
    await dialog.getByRole('link', { name: 'GeoNames', exact: true }).scrollIntoViewIfNeeded();
    await expect(dialog.getByRole('link', { name: 'GeoNames', exact: true })).toBeInViewport();
    expect((await screenSize()).scroll).toBe(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '查找电台', exact: true })).toBeFocused();
    await page.setViewportSize({ width, height: height - 100 });
    const resized = await screenSize();
    expect(resized.height).toBeLessThanOrEqual(resized.viewportHeight);
    await expect(page.getByRole('button', { name: '播放', exact: true })).toBeInViewport();
  });
}
