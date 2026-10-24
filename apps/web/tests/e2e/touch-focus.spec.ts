import { test, expect, type Locator } from '@playwright/test';
import { first, install, selectStation } from './listening-fixture.js';

async function expectNoRing(control: Locator) {
  await expect(control).toHaveCSS('outline-style', 'none');
}

test('touch controls avoid residual rings and restore keyboard focus indicators', async ({
  browser,
  browserName,
}) => {
  test.skip(browserName === 'firefox', 'Firefox does not emulate touch contexts');
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    locale: 'zh-CN',
  });
  const page = await context.newPage();
  await install(page);
  await page.goto('/');
  for (const name of ['我的收听', '收听设置', '关于与帮助']) {
    const opener = page.getByRole('button', { name, exact: true });
    await opener.tap();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const close = dialog.getByRole('button', { name: '关闭面板', exact: true });
    await expectNoRing(close);
    await page.keyboard.press('Tab');
    await expect(dialog.locator(':focus')).toHaveCSS('outline-style', 'solid');
    await close.tap();
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    await expectNoRing(opener);
  }
  const search = page.getByRole('button', { name: '查找电台', exact: true });
  await search.tap();
  await expect(page.getByRole('searchbox')).toBeFocused();
  const closeSearch = page
    .locator('#station-directory')
    .getByRole('button', { name: '关闭面板', exact: true });
  await closeSearch.tap();
  await expect(search).toBeFocused();
  await expectNoRing(search);

  const filters = page.getByRole('button', { name: '筛选电台', exact: true });
  await filters.tap();
  await expectNoRing(filters);
  await page.getByRole('button', { name: '关闭面板', exact: true }).tap();
  await expect(filters).toBeFocused();
  await expectNoRing(filters);

  await selectStation(page, first.name);
  const favorite = page.getByRole('button', { name: '收藏 ' + first.name, exact: true });
  await favorite.tap();
  const saved = page.getByRole('button', { name: /取消收藏 Harbor Jazz/ });
  await expect(saved).toHaveAttribute('aria-pressed', 'true');
  await expectNoRing(saved);
  const map = page.getByRole('button', { name: '地图信息', exact: true });
  await expect(map).toBeEnabled();
  await map.tap();
  await expectNoRing(map);
  await page.getByRole('button', { name: '关闭面板', exact: true }).tap();
  await expect(map).toBeFocused();
  await expectNoRing(map);

  const immersive = page.getByRole('button', { name: '沉浸收听', exact: true });
  await immersive.tap();
  const exit = page.getByRole('button', { name: '返回探索', exact: true });
  await expect(exit).toBeFocused();
  await expectNoRing(exit);
  await page.getByRole('button', { name: '远山', exact: true }).tap();
  await expectNoRing(page.getByRole('button', { name: '远山', exact: true }));
  await exit.tap();
  await expect(immersive).toBeFocused();
  await expectNoRing(immersive);
  await context.close();
});
