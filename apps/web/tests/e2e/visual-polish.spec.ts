import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { first, install, openDirectory, selectStation } from './listening-fixture.js';

for (const [width, height] of [
  [1440, 900],
  [1280, 720],
  [390, 844],
  [320, 700],
  [844, 390],
] as const) {
  test(`keeps panel headings and clear-search focus usable at ${width}x${height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
    await install(page);
    await page.goto('/');
    await selectStation(page, first.name);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await expect(page.getByTestId('globe-panel')).toHaveAttribute('data-state', 'ready');
    await page.screenshot({ path: info.outputPath('listening.png') });
    await openDirectory(page);
    await page.getByRole('searchbox').fill('River');
    await expect(
      page.locator('#station-directory').getByRole('button', { name: /收听 River/ }),
    ).toBeVisible();
    await page.locator('header').getByRole('button', { name: '清除搜索', exact: true }).click();
    await expect(page.getByRole('searchbox')).toBeFocused();
    await expect(page.getByRole('searchbox')).toHaveValue('');
    await page.getByRole('searchbox').press('Escape');
    await openDirectory(page);
    await expect(page.getByRole('searchbox')).toBeFocused();
    await page.getByRole('searchbox').press('Escape');
    await page.getByRole('button', { name: '收听设置', exact: true }).click();
    const panel = page.getByRole('dialog', { name: '收听设置' });
    const close = panel.getByRole('button', { name: '关闭面板', exact: true });
    await expect(close).toBeFocused();
    const play = page.getByRole('button', { name: '播放', exact: true });
    expect(
      await play.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return el.contains(
          document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
        );
      }),
    ).toBe(true);
    await panel.getByRole('heading', { name: '键盘操作', exact: true }).scrollIntoViewIfNeeded();
    await expect(close).toBeInViewport();
    const header = await panel
      .getByRole('heading', { name: '收听设置', exact: true })
      .boundingBox();
    const box = await panel.boundingBox();
    expect(header!.y).toBeGreaterThanOrEqual(box!.y);
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath('settings-scrolled.png') });
    await close.click();
    await expect(page.getByRole('button', { name: '收听设置', exact: true })).toBeFocused();
    await page
      .getByRole('navigation', { name: '流派', exact: true })
      .getByRole('button', { name: '筛选电台', exact: true })
      .click();
    const filters = page.getByRole('region', { name: '筛选电台', exact: true });
    await filters
      .getByRole('button', { name: '清除全部条件', exact: true })
      .scrollIntoViewIfNeeded();
    await expect(filters.getByRole('button', { name: '关闭面板', exact: true })).toBeInViewport();
    expect(
      await play.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return el.contains(
          document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
        );
      }),
    ).toBe(true);
    await filters.getByRole('button', { name: '关闭面板', exact: true }).click();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}
