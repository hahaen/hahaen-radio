import { expect, test } from '@playwright/test';
import { first, install, selectStation } from './listening-fixture.js';

for (const [width, height] of [
  [1440, 900],
  [768, 1024],
  [390, 844],
  [320, 700],
  [844, 390],
] as const) {
  test(`animates the playback indicator only while playing at ${width}x${height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await install(page);
    await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
    await page.goto('/');
    await selectStation(page, first.name);
    const status = page.getByRole('status');
    await expect(status).toHaveAttribute('data-state', 'playing');
    const style = () =>
      status.evaluate((element) => {
        const css = getComputedStyle(element, '::before');
        return {
          animation: css.animationName,
          bars: css.backgroundSize,
          height: css.height,
          width: css.width,
        };
      });
    const moving = await style();
    expect(moving.animation).not.toBe('none');
    await expect.poll(async () => (await style()).bars).not.toBe(moving.bars);
    expect(moving).toMatchObject({ height: '14px', width: '19px' });
    await expect(status).toHaveText('正在收听');
    await expect(status).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath('playing-indicator.png') });
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await expect(status).toHaveAttribute('data-state', 'paused');
    expect(await style()).toMatchObject({ animation: 'none', height: '1px' });
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await expect(status).toHaveAttribute('data-state', 'playing');
    await page.locator('audio').evaluate((element) => element.dispatchEvent(new Event('waiting')));
    await expect(status).toHaveAttribute('data-state', 'buffering');
    expect((await style()).animation).not.toBe(moving.animation);
    await page.locator('audio').evaluate((element) => element.dispatchEvent(new Event('playing')));
    await expect(status).toHaveAttribute('data-state', 'playing');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await style()).toMatchObject({ animation: 'none', height: '14px' });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByRole('button', { name: '收听设置', exact: true }).click();
    await page.getByRole('checkbox', { name: '省电模式', exact: true }).check();
    await page.keyboard.press('Escape');
    expect(await style()).toMatchObject({ animation: 'none', height: '14px' });
    await expect(status).toHaveAttribute('data-state', 'playing');
    expect(
      await page.locator('audio').evaluate((element: HTMLAudioElement) => element.paused),
    ).toBe(false);
    await expect(page.locator('audio')).toHaveCount(1);
  });
}
