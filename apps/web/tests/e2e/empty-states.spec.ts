import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { install, openDirectory } from './listening-fixture.js';

for (const [width, height, english] of [
  [1440, 900, false],
  [390, 844, false],
  [320, 700, false],
  [390, 844, true],
] as const) {
  test(`keeps empty listening lists and search recovery clear at ${width}x${height} ${english ? 'en' : 'zh'}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
    await install(page);
    await page.goto('/');
    if (english) await page.getByRole('button', { name: 'EN', exact: true }).click();
    await page
      .getByRole('button', { name: english ? 'My listening' : '我的收听', exact: true })
      .click();
    const panel = page.getByRole('dialog');
    await expect(
      panel.getByRole('heading', {
        name: english ? 'No favorite stations yet' : '还没有收藏电台',
        exact: true,
      }),
    ).toBeVisible();
    await expect(panel.locator('button:disabled')).toHaveCount(0);
    await expect(
      panel.getByRole('button', {
        name: english ? 'Favorite stations (0)' : '电台收藏（0）',
        exact: true,
      }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('empty-favorites.png') });
    await panel
      .getByRole('button', { name: english ? 'Recently played (0)' : '最近收听（0）', exact: true })
      .click();
    await expect(
      panel.getByRole('heading', {
        name: english ? 'No listening history yet' : '还没有收听记录',
        exact: true,
      }),
    ).toBeVisible();
    await panel
      .getByRole('button', { name: english ? 'Saved songs (0)' : '歌曲收藏（0）', exact: true })
      .click();
    await expect(
      panel.getByRole('heading', {
        name: english ? 'No saved songs yet' : '还没有收藏歌曲',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      panel.getByRole('button', { name: english ? 'Copy song list' : '复制歌曲清单', exact: true }),
    ).toHaveCount(0);
    await expect(
      panel.getByRole('button', { name: english ? 'Import favorites' : '导入收藏', exact: true }),
    ).toBeEnabled();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await panel
      .getByRole('button', { name: english ? 'Close panel' : '关闭面板', exact: true })
      .click();
    await openDirectory(page);
    const clock = page.getByRole('complementary', {
      name: english ? 'China time' : '中国时间',
      exact: true,
    });
    if (width < 768) await expect(clock).toBeHidden();
    await page.getByRole('searchbox').fill('no-match-572199');
    const directory = page.locator('#station-directory');
    await expect(
      directory.getByRole('heading', {
        name: english ? 'No stations found' : '暂时没有找到电台',
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath('empty-search.png') });
    await directory
      .getByRole('button', { name: english ? 'Show all stations' : '查看全部电台', exact: true })
      .click();
    await expect(page.getByRole('searchbox')).toHaveValue('');
    await expect(
      directory.getByRole('button', { name: /^(Listen to|收听) Harbor Jazz/ }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('searchbox').press('Escape');
    await expect(clock).toBeVisible();
  });
}
