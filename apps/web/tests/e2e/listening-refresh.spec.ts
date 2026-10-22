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
  expect(heading!.y).toBeGreaterThanOrEqual(footer!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('mobile-first-screen.png') });
  await page.getByText('电台详情', { exact: true }).click();
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
  await dialog.getByRole('combobox', { name: '沉浸画面', exact: true }).selectOption('dunes');
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
  await page.getByRole('button', { name: '沉浸收听', exact: true }).click();
  await expect(page.locator('[data-effect="dunes"]')).toHaveAttribute('data-still', 'true');
  await page.reload();
  await page.getByRole('button', { name: '收听设置', exact: true }).click();
  await expect(dialog.getByRole('checkbox', { name: '省电模式', exact: true })).toBeChecked();
  await expect(dialog.getByRole('combobox', { name: '沉浸画面', exact: true })).toHaveValue(
    'dunes',
  );
});

for (const fallback of [false, true]) {
  test(`restores a legacy genre view to the globe with WebGL fallback ${fallback}`, async ({
    page,
  }, info) => {
    await install(page);
    await page.addInitScript((fallback) => {
      localStorage.setItem(
        'haen:personal:v1:preferences',
        JSON.stringify({
          version: 1,
          value: {
            volume: 0.4,
            muted: true,
            showHints: false,
            view: 'genres',
            idleImmersive: false,
          },
        }),
      );
      if (fallback) {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (
          this: HTMLCanvasElement,
          kind: string,
          ...args: unknown[]
        ) {
          if (kind.startsWith('webgl')) return null;
          return Reflect.apply(original, this, [kind, ...args]);
        } as typeof original;
      }
    }, fallback);
    await page.goto('/');
    const globe = page.getByTestId('globe-panel');
    await expect(globe).toHaveAttribute('data-state', fallback ? 'unavailable' : 'ready');
    await expect(page.getByRole('button', { name: /^(流派|地球)$/ })).toHaveCount(0);
    await selectStation(page, first.name);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press('g');
    await expect(page.getByRole('group', { name: '按流派探索' })).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveAttribute('data-state', 'paused');
    await page.getByRole('button', { name: '收听设置', exact: true }).click();
    const settings = page.getByRole('dialog');
    await expect(settings.getByRole('slider', { name: '音量', exact: true })).toHaveValue('0.4');
    await expect(settings.getByRole('checkbox', { name: '静音', exact: true })).toBeChecked();
    await expect(
      settings.getByRole('checkbox', { name: '显示操作提示', exact: true }),
    ).not.toBeChecked();
    await expect(settings.getByText('切换地球与流派', { exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await expect(page.getByRole('button', { name: /^(Genre|Globe)$/ })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Genres', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(first.name);
    await page.screenshot({ path: info.outputPath('globe-only.png') });
  });
}
