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
  for (const effect of ['aurora', 'ocean', 'dunes']) {
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
  await page.setViewportSize({ width: 320, height: 700 });
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.getByRole('button', { name: 'Immersive listening', exact: true }).click();
  const translated = page.getByRole('main', { name: 'Immersive listening', exact: true });
  await expect(
    translated.getByRole('button', { name: 'Back to exploration', exact: true }),
  ).toBeInViewport();
  for (const name of ['Aurora', 'Tides', 'Dunes']) {
    await expect(translated.getByRole('button', { name, exact: true })).toBeInViewport();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('keeps tidal and mountain scenes clear of phone controls through viewport changes', async ({
  page,
}, info) => {
  await install(page);
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?station=' + first.id);
  await page.getByRole('button', { name: '沉浸收听', exact: true }).click();
  const immersive = page.getByRole('main', { name: '沉浸收听', exact: true });
  for (const [width, height] of [
    [390, 844],
    [320, 700],
    [375, 667],
    [844, 390],
    [768, 1024],
    [1440, 900],
  ]) {
    await page.setViewportSize({ width: width!, height: height! });
    for (const name of ['潮汐', '远山']) {
      await immersive.getByRole('button', { name, exact: true }).click();
      const heading = immersive.getByRole('heading', { level: 1 });
      const favorite = immersive.getByRole('button', { name: /收藏 Harbor Jazz/ });
      await expect(heading).toBeInViewport();
      await expect(favorite).toBeInViewport();
      const title = (await heading.boundingBox())!;
      const footer = (await page.getByRole('contentinfo').boundingBox())!;
      const back = (await immersive
        .getByRole('button', { name: '返回探索', exact: true })
        .boundingBox())!;
      expect(title.y).toBeGreaterThan(back.y + back.height);
      expect(title.y + title.height).toBeLessThan(footer.y);
      const star = (await favorite.boundingBox())!;
      expect(star.y + star.height).toBeLessThan(footer.y);
      await expect(page.getByRole('button', { name: '播放', exact: true })).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: info.outputPath(`${width}-${height}-${name === '潮汐' ? 'ocean' : 'dunes'}.png`),
      });
    }
  }
});
