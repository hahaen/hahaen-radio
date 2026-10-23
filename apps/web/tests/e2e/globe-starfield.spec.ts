import { expect, test } from '@playwright/test';
import { first, install } from './listening-fixture.js';

test('keeps the decorative sky behind the globe and controls at every layout size', async ({
  page,
}, info) => {
  await install(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?station=' + first.id);
  await page.bringToFront();
  const panel = page.getByTestId('globe-panel');
  await expect(panel).toHaveAttribute('data-state', 'ready', { timeout: 15000 });
  const sky = panel.locator('svg[data-animated]');
  await expect(sky).toHaveAttribute('aria-hidden', 'true');
  await expect(sky).toHaveAttribute('focusable', 'false');
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
    [768, 1024],
    [390, 844],
    [320, 700],
    [844, 390],
  ] as const) {
    await page.setViewportSize({ width, height });
    const canvas = panel.locator('canvas');
    const bounds = (await canvas.locator('..').locator('..').boundingBox())!;
    expect(
      await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      }),
    ).toBe('CANVAS');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`sky-${width}-${height}.png`) });
    await canvas.press('ArrowLeft');
  }
  await page.getByRole('button', { name: /^(查找电台|Find a station)$/ }).click();
  await expect(page.getByRole('searchbox')).toBeVisible();
  expect(errors).toEqual([]);
});

test('twinkles gently only during playback and stops for motion, power and visibility preferences', async ({
  page,
}) => {
  await install(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
  await page.goto('/?station=' + first.id);
  await page.bringToFront();
  const panel = page.getByTestId('globe-panel');
  await expect(panel).toHaveAttribute('data-state', 'ready', { timeout: 15000 });
  const sky = panel.locator('svg[data-animated]');
  const animation = () =>
    sky.evaluate((element) => getComputedStyle(element.lastElementChild!).animationName);
  await expect.poll(animation).toBe('none');
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
  await expect.poll(animation).not.toBe('none');
  const opacity = await sky.evaluate(
    (element) => getComputedStyle(element.lastElementChild!).opacity,
  );
  await expect
    .poll(() => sky.evaluate((element) => getComputedStyle(element.lastElementChild!).opacity))
    .not.toBe(opacity);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect.poll(animation).toBe('none');
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(animation).toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(animation).not.toBe('none');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(animation).toBe('none');
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.bringToFront();
  await expect.poll(animation).not.toBe('none');
  await page.getByRole('button', { name: '收听设置', exact: true }).click();
  await page.getByRole('checkbox', { name: '省电模式', exact: true }).check();
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  await expect.poll(animation).toBe('none');
});
