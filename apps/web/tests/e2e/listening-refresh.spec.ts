import { test, expect } from '@playwright/test';
import { first, second, install, selectStation } from './listening-fixture.js';
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
});
test('keeps mobile station identity and primary controls in the first screen', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await install(page);
  await page.goto('/');
  await selectStation(page, first.name);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.evaluate(() => scrollTo(0, 0));
  const heading = await page.getByRole('heading', { level: 1 }).boundingBox();
  const footer = await page.getByRole('contentinfo').boundingBox();
  expect(heading!.y + heading!.height).toBeLessThan(footer!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('mobile-first-screen.png') });
  const dial = page.getByRole('slider', { name: '拨动选择当前范围内的电台' });
  await dial.focus();
  await dial.press('ArrowRight');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(second.name);
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'paused');
});
test('preserves older preferences and remembers scene choices without changing playback', async ({
  page,
}) => {
  await install(page);
  await page.addInitScript(() => {
    if (!localStorage.getItem('haen:personal:v1:preferences'))
      localStorage.setItem(
        'haen:personal:v1:preferences',
        JSON.stringify({
          version: 1,
          value: {
            volume: 0.4,
            muted: false,
            showHints: true,
            view: 'globe',
            idleImmersive: false,
          },
        }),
      );
  });
  await page.goto('/');
  await selectStation(page, first.name);
  await page.getByRole('button', { name: '收听设置', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: '省电模式', exact: true }).check();
  await dialog.getByRole('combobox', { name: '沉浸画面', exact: true }).selectOption('landscape');
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
  await page.getByRole('button', { name: '沉浸收听', exact: true }).click();
  await expect(page.locator('[data-effect="landscape"]')).toHaveAttribute('data-still', 'true');
  await page.reload();
  await page.getByRole('button', { name: '收听设置', exact: true }).click();
  await expect(dialog.getByRole('checkbox', { name: '省电模式', exact: true })).toBeChecked();
  await expect(dialog.getByRole('combobox', { name: '沉浸画面', exact: true })).toHaveValue(
    'landscape',
  );
});
test('keeps genre selection usable with and without WebGL', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await install(page);
  await page.goto('/');
  await page.getByRole('button', { name: '流派', exact: true }).click();
  const atlas = page.getByRole('group', { name: '按流派探索' });
  await expect(atlas.getByRole('button', { name: /爵士.*1 台/ })).toBeVisible();
  const webgl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2');
    context?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!context;
  });
  if (webgl) {
    await expect(atlas).toHaveAttribute('data-rendered', 'true');
    await expect(atlas.locator('canvas')).toHaveCount(1);
  }
  await atlas.getByRole('button', { name: /爵士.*1 台/ }).click();
  await expect(page.getByRole('heading', { name: '爵士', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('genre-scene.png'), fullPage: true });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
      ...args: unknown[]
    ) {
      if (kind.startsWith('webgl')) return null;
      return Reflect.apply(original, this, [kind, ...args]);
    } as typeof original;
  });
  await page.reload();
  await expect(atlas.getByRole('button', { name: /爵士.*1 台/ })).toBeVisible();
  await atlas.getByRole('button', { name: /爵士.*1 台/ }).click();
  await expect(page.getByRole('heading', { name: '爵士', exact: true })).toBeVisible();
});
