import { expect, test } from '@playwright/test';
import { first, install, selectStation } from './listening-fixture.js';

test('favicon follows actual playback and motion preferences', async ({ page }) => {
  test.setTimeout(60_000);
  await install(page, false);
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const icons = page.locator('link[rel="icon"]');
  const attributes = () =>
    icons.evaluateAll((elements) =>
      elements.map((element) =>
        ['href', 'type', 'sizes'].map((name) => element.getAttribute(name)),
      ),
    );
  const original = await attributes();
  const href = () => icons.first().getAttribute('href');
  const moving = async () => {
    await expect.poll(href).toMatch(/^data:image\/png;base64,/);
    const frame = await href();
    await expect
      .poll(async () => {
        const values = await attributes();
        const next = values[0]?.[0];
        // A temporary buffering fallback must not count as an animation frame.
        return (
          !!next?.startsWith('data:image/png;base64,') &&
          next !== frame &&
          JSON.stringify(values[0]) === JSON.stringify(values[1])
        );
      })
      .toBe(true);
  };
  await selectStation(page, first.name);
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
  await moving();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect.poll(attributes).toEqual(original);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await moving();
  await page.locator('audio').evaluate((audio) => audio.dispatchEvent(new Event('waiting')));
  await expect.poll(attributes).toEqual(original);
  await page.locator('audio').evaluate((audio) => audio.dispatchEvent(new Event('playing')));
  await moving();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(attributes).toEqual(original);
  await page.waitForTimeout(500);
  expect(await attributes()).toEqual(original);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await moving();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hidden = await attributes();
  await page.waitForTimeout(600);
  expect(await attributes()).toEqual(hidden);
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await moving();
  await page.getByRole('button', { name: '收听设置', exact: true }).click();
  await page.getByRole('checkbox', { name: '省电模式', exact: true }).check();
  await expect.poll(attributes).toEqual(original);
  await page.waitForTimeout(500);
  expect(await attributes()).toEqual(original);
  await page.getByRole('checkbox', { name: '省电模式', exact: true }).uncheck();
  await moving();
  await expect(page.locator('audio')).toHaveCount(1);
  expect(await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(
    false,
  );
});

test('missing favicon image does not interrupt playback', async ({ page }) => {
  await install(page, false);
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
  await page.route('**/haen-favicon-v3.png', (route) => route.abort());
  await page.goto('/');
  await selectStation(page, first.name);
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
  await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute('href', /\.ico$/);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'paused');
});
