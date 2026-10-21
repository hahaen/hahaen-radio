import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { first, install } from './listening-fixture.js';

test('keeps every immersive artwork readable, accessible and on the same playback session', async ({
  page,
}, info) => {
  await page.setViewportSize(
    info.project.name === 'mobile-chromium'
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await install(page);
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
  await page.goto('/?station=' + first.id);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
  for (const effect of ['record', 'orb', 'landscape']) {
    await page.getByRole('button', { name: '收听设置', exact: true }).click();
    await page.getByRole('combobox', { name: '沉浸画面', exact: true }).selectOption(effect);
    await page.getByRole('button', { name: '关闭面板', exact: true }).click();
    await page.getByRole('button', { name: '沉浸收听', exact: true }).click();
    const immersive = page.getByRole('main', { name: '沉浸收听', exact: true });
    const art = immersive.locator('[data-effect]');
    await expect(art).toHaveAttribute('data-effect', effect);
    await expect(immersive.getByRole('heading', { level: 1 })).toHaveText(first.name);
    await expect(immersive.getByRole('status')).toHaveAttribute('data-state', 'playing');
    await expect(page.locator('audio')).toHaveCount(1);
    const title = (await immersive.getByRole('heading', { level: 1 }).boundingBox())!;
    const footer = (await page.getByRole('contentinfo').boundingBox())!;
    expect(title.y + title.height).toBeLessThan(footer.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const result = await new AxeBuilder({ page }).analyze();
    expect(result.violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`immersive-${effect}.png`) });
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await expect(immersive.getByRole('status')).toHaveAttribute('data-state', 'paused');
    await expect(art).toHaveAttribute('data-playing', 'false');
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await page.getByRole('button', { name: '返回探索', exact: true }).click();
  }
});
