import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { first, second, install, selectStation, openDirectory } from './listening-fixture.js';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
});

for (const [width, height] of [
  [1440, 900],
  [768, 1024],
  [390, 844],
  [320, 700],
  [844, 390],
] as const) {
  test(`composes the globe beside listening controls at ${width}x${height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
    await install(page);
    await page.goto('/');
    await selectStation(page, first.name);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await expect(page.getByTestId('globe-panel')).toHaveAttribute('data-state', 'ready');
    await expect(page.getByRole('button', { name: /^(流派|地球)$/ })).toHaveCount(0);
    await expect(page.getByRole('group', { name: '探索方式' })).toHaveCount(0);
    const canvas = page.getByRole('img', { name: /可旋转的地球/ });
    const bounds = await canvas.boundingBox();
    const sceneCenter = width * (width >= 1024 ? 0.59 : 0.5);
    expect(Math.abs(bounds!.x + bounds!.width / 2 - sceneCenter)).toBeLessThan(2);
    const player = page.getByRole('contentinfo');
    const dock = await player.boundingBox();
    const heading = await player.getByRole('heading', { name: first.name }).boundingBox();
    expect(heading!.y).toBeGreaterThanOrEqual(dock!.y);
    expect(dock!.y + dock!.height).toBeLessThan(height - 55);
    if (width >= 768) expect(dock!.width).toBeLessThan(width / 2);
    if (width >= 768 && width < 1024 && height >= 600)
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(dock!.y);
    await expect(player.getByRole('button', { name: '播放', exact: true })).toBeInViewport();
    const volume = await player.getByRole('slider', { name: '音量', exact: true }).boundingBox();
    expect(volume!.x + volume!.width).toBeLessThanOrEqual(dock!.x + dock!.width);
    await expect(page.getByRole('button', { name: /放大|缩小|重置地球|定位当前/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '曲目与歌词', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /手动识曲|识别当前/ })).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth &&
          document.documentElement.scrollHeight <= innerHeight,
      ),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath('celestial-listening.png') });
    await openDirectory(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const search = page.getByRole('searchbox');
    await expect(search).toBeFocused();
    await search.fill('River');
    await expect(
      page.locator('#station-directory').getByRole('button', { name: /收听 River Pop/ }),
    ).toBeVisible();
    await expect(
      page.locator('#station-directory').getByRole('button', { name: /收听 Harbor Jazz/ }),
    ).toHaveCount(0);
    await search.press('Escape');
    await expect(page.getByRole('button', { name: '查找电台', exact: true })).toBeFocused();
    await page.getByRole('button', { name: '我的收听', exact: true }).click();
    const panel = page.getByRole('dialog', { name: '我的收听', exact: true });
    await expect(panel).toBeVisible();
    expect(await panel.getAttribute('aria-modal')).not.toBe('true');
    expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(480);
    await page.screenshot({ path: info.outputPath('compact-library.png') });
    await panel.press('Escape');
    await expect(panel).toHaveCount(0);
  });
}

test('filters from the bottom dock and keeps selection paused while filtering', async ({
  page,
}, info) => {
  await install(page);
  await page.goto('/');
  await selectStation(page, first.name);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const genres = page.getByRole('navigation', { name: '流派', exact: true });
  await genres.getByRole('button', { name: /^流行/ }).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'paused');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(first.name);
  await openDirectory(page);
  await expect(
    page
      .locator('#station-directory')
      .getByRole('button', { name: new RegExp('收听 ' + second.name) }),
  ).toBeVisible();
  await expect(
    page
      .locator('#station-directory')
      .getByRole('button', { name: new RegExp('收听 ' + first.name) }),
  ).toHaveCount(0);
  await page.locator('#station-search').press('Escape');
  await genres.getByRole('button', { name: /^全部流派/ }).click();
  await expect(page.getByTestId('globe-panel')).toBeVisible();
  await page.screenshot({ path: info.outputPath('globe-filter-reset.png') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'paused');
});

test('keeps icon navigation and expanded search accessible in both languages', async ({ page }) => {
  await install(page);
  await page.goto('/');
  for (const language of ['中文', 'EN']) {
    await page.getByRole('button', { name: language, exact: true }).click();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole('button', { name: /^(查找电台|Find a station)$/ }).click();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.locator('#station-search').press('Escape');
  }
});
