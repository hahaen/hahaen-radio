import { expect, test } from '@playwright/test';
import { first, install, selectStation } from './listening-fixture.js';

for (const [width, height] of [
  [1440, 900],
  [768, 1024],
  [390, 844],
  [320, 700],
  [844, 390],
] as const) {
  test(`player motion respects playback and preferences at ${width}x${height}`, async ({
    page,
  }, info) => {
    test.skip(
      info.project.name === 'mobile-chromium'
        ? width !== 390
        : info.project.name !== 'chromium' && width !== 1440,
      'Chromium covers responsive layouts; other engines cover desktop and native touch emulation.',
    );
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await install(page);
    await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
    await page.addInitScript(() => {
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        const animation = animate.apply(this, args);
        if (this.closest('[data-control-motion]')) {
          this.setAttribute(
            'data-motion-count',
            String(Number(this.getAttribute('data-motion-count') ?? 0) + 1),
          );
        }
        return animation;
      };
    });
    await page.goto('/');
    await selectStation(page, first.name);
    const player = page.getByRole('contentinfo', { name: '电台播放器', exact: true });
    const play = player.getByRole('button', { name: '暂停', exact: true });
    const glow = () =>
      play.evaluate((element) => {
        const css = getComputedStyle(element, '::before');
        return { name: css.animationName, opacity: css.opacity };
      });
    await expect(player).toHaveAttribute('data-playing', 'true');
    await expect.poll(async () => (await glow()).name).not.toBe('none');
    const bounds = await play.boundingBox();
    const breath = await play.evaluate((element) => {
      const name = getComputedStyle(element, '::before').animationName;
      const animation = element
        .getAnimations({ subtree: true })
        .find((item) => item instanceof CSSAnimation && item.animationName === name);
      if (!animation) throw new Error('Playback glow has no running animation');
      const running = animation.playState;
      animation.pause();
      animation.currentTime = 0;
      const low = Number(getComputedStyle(element, '::before').opacity);
      animation.currentTime = 2500;
      const high = Number(getComputedStyle(element, '::before').opacity);
      animation.play();
      return { low, high, running };
    });
    expect(breath.running).toBe('running');
    expect(breath.high).toBeGreaterThan(breath.low);
    expect(await play.boundingBox()).toEqual(bounds);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath('playing.png') });

    const favorite = player
      .locator('[data-control-motion="press"]')
      .filter({ has: page.locator('.lucide-star') });
    const icon = favorite.locator('svg');
    await favorite.focus();
    await page.keyboard.press('Enter');
    await expect(favorite).toHaveAttribute('aria-pressed', 'true');
    await expect(icon).toHaveAttribute('data-motion-count', '1');
    await expect.poll(() => icon.evaluate((element) => element.getAnimations().length)).toBe(0);
    await favorite.click();
    await expect(favorite).toHaveAttribute('aria-pressed', 'false');
    await expect(icon).toHaveAttribute('data-motion-count', '2');

    await page.locator('audio').evaluate((element) => element.dispatchEvent(new Event('waiting')));
    await expect.poll(async () => (await glow()).name).toBe('none');
    await page.locator('audio').evaluate((element) => element.dispatchEvent(new Event('playing')));
    await expect.poll(async () => (await glow()).name).not.toBe('none');
    await play.click();
    const paused = player.getByRole('button', { name: '播放', exact: true });
    await expect(player).toHaveAttribute('data-playing', 'false');
    expect(await paused.evaluate((element) => getComputedStyle(element, '::before').opacity)).toBe(
      '0',
    );
    await paused.click();
    await expect(player).toHaveAttribute('data-playing', 'true');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(async () => (await glow()).name).toBe('none');
    await favorite.click();
    await expect(icon).toHaveAttribute('data-motion-count', '2');
    expect(await icon.evaluate((element) => element.getAnimations().length)).toBe(0);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(async () => (await glow()).name).not.toBe('none');

    // Simulate visibility changes without relying on headless browser tab scheduling.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(async () => (await glow()).name).toBe('none');
    await page.evaluate(() => {
      Reflect.deleteProperty(document, 'hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(async () => (await glow()).name).not.toBe('none');

    await page.getByRole('button', { name: '收听设置', exact: true }).click();
    await page.getByRole('checkbox', { name: '省电模式', exact: true }).check();
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await glow()).name).toBe('none');
    await favorite.click();
    await expect(icon).toHaveAttribute('data-motion-count', '2');
    expect(await icon.evaluate((element) => element.getAnimations().length)).toBe(0);
    await expect(player).toHaveAttribute('data-playing', 'true');
    await expect(page.locator('audio')).toHaveCount(1);
    expect(
      await page.locator('audio').evaluate((element: HTMLAudioElement) => element.paused),
    ).toBe(false);
  });
}
