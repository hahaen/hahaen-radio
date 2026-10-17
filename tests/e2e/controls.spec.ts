import { expect, test, type Page } from '@playwright/test';
import { first, second, install, listenButton } from './listening-fixture.js';
const preferences = 'haen:personal:v1:preferences';
async function enter(page: Page) {
  await install(page);
  await page.goto('/');
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await expect(page.getByTestId('directory-state')).toHaveText('找到 3 个电台');
}
async function play(page: Page, name = first.name) {
  await listenButton(page, name).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
}
async function settings(page: Page) {
  await page.getByRole('button', { name: '收听设置', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '收听设置', exact: true })).toBeVisible();
  return page.locator('dialog');
}
async function bodyKey(page: Page, key: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press(key);
}
test('persists actual settings and synchronizes independent preferences and language across tabs', async ({
  page,
  context,
}) => {
  await enter(page);
  await play(page);
  const dialog = await settings(page);
  await dialog.getByRole('slider', { name: '音量', exact: true }).fill('0.32');
  await dialog.getByRole('checkbox', { name: '静音', exact: true }).check();
  await dialog.getByRole('checkbox', { name: '显示操作提示', exact: true }).uncheck();
  await dialog.getByRole('checkbox', { name: /法语/ }).check();
  expect(
    await page.locator('audio').evaluate((audio: HTMLAudioElement) => ({
      volume: audio.volume,
      muted: audio.muted,
      paused: audio.paused,
    })),
  ).toEqual({ volume: 0.32, muted: true, paused: false });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '收听设置', exact: true })).toBeFocused();
  const other = await context.newPage();
  await install(other);
  await other.goto('/');
  await expect(other.getByRole('heading', { level: 1 })).toHaveText(first.name);
  const otherDialog = await settings(other);
  await expect(otherDialog.getByRole('slider', { name: '音量', exact: true })).toHaveValue('0.32');
  await expect(otherDialog.getByRole('checkbox', { name: '静音', exact: true })).toBeChecked();
  await otherDialog.getByRole('checkbox', { name: '显示操作提示', exact: true }).check();
  await otherDialog.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('slider', { name: 'Volume', exact: true })).toHaveValue('0.32');
  await otherDialog.getByRole('button', { name: 'Close panel', exact: true }).click();
  await other.getByRole('button', { name: 'Genre', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Genre', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.reload();
  await expect(page.getByRole('button', { name: 'Genre', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('slider', { name: 'Volume', exact: true })).toHaveValue('0.32');
  await expect(page.getByRole('button', { name: 'Unmute', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('audio')).toHaveCount(0);
  expect(
    JSON.parse((await page.evaluate((key) => localStorage.getItem(key), preferences))!).value
      .showHints,
  ).toBe(true);
  await other.close();
});
test('rechecks sleep deadlines on resume, distinguishes restart and cancellation, and pauses real media once', async ({
  page,
}) => {
  await page.clock.install();
  await enter(page);
  await play(page);
  let dialog = await settings(page);
  await dialog.getByRole('button', { name: '15 分钟', exact: true }).click();
  await expect(dialog.getByText('剩余 15:00', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '30 分钟', exact: true }).click();
  await expect(dialog.getByText('剩余 30:00', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '60 分钟', exact: true }).click();
  await expect(dialog.getByText('剩余 60:00', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.clock.setSystemTime(Date.now() + 61 * 60000);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect(await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(
    false,
  );
  await dialog.getByRole('button', { name: '15 分钟', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '剩余 15:00', exact: true })).toBeVisible();
  await page.clock.setSystemTime(Date.now() + 80 * 60000);
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'paused');
  expect(await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(
    true,
  );
  dialog = await settings(page);
  await expect(dialog.getByText('睡眠定时已结束。', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
});
test('keeps keyboard commands, immersion, focus, and refreshed previous navigation on the same audio controller', async ({
  page,
}) => {
  await enter(page);
  await play(page);
  await play(page, second.name);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: '上一站', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '上一站', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(first.name);
  await expect(page.locator('audio')).toHaveCount(0);
  await bodyKey(page, 'Space');
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
  await bodyKey(page, 'f');
  await expect(
    page.getByRole('button', { name: '已收藏 取消收藏 ' + first.name, exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await bodyKey(page, 'l');
  await expect(page.getByRole('button', { name: '取消固定', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await bodyKey(page, 'm');
  expect(await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.muted)).toBe(true);
  await bodyKey(page, 'g');
  await expect(page.getByRole('button', { name: '流派', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await bodyKey(page, '/');
  await expect(page.getByRole('searchbox', { name: '搜索电台', exact: true })).toBeFocused();
  await page.keyboard.type('fm');
  await page.keyboard.press('Space');
  expect(await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(
    false,
  );
  await bodyKey(page, 'Enter');
  const immersive = page.getByRole('main', { name: '沉浸收听', exact: true });
  await expect(immersive).toBeVisible();
  await expect(immersive.getByRole('button', { name: '返回探索', exact: true })).toBeFocused();
  await expect(page.locator('audio')).toHaveCount(1);
  await bodyKey(page, 'Space');
  await expect(immersive.getByRole('status')).toHaveAttribute('data-state', 'paused');
  await bodyKey(page, '/');
  await expect(immersive).toHaveCount(0);
  await expect(page.getByRole('searchbox', { name: '搜索电台', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '沉浸收听', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '沉浸收听', exact: true })).toBeFocused();
});
test('enters idle immersion only while actually playing and respects editing, dialogs and reduced motion', async ({
  page,
}) => {
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await enter(page);
  await play(page);
  const dialog = await settings(page);
  await dialog.getByRole('checkbox', { name: '收听时闲置 30 秒进入沉浸', exact: true }).check();
  await page.clock.fastForward(31000);
  await expect(page.getByRole('main', { name: '沉浸收听', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '关于与帮助', exact: true }).click();
  await page.clock.fastForward(31000);
  await expect(page.getByRole('dialog', { name: '关于与帮助', exact: true })).toBeVisible();
  await expect(page.getByRole('main', { name: '沉浸收听', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('searchbox', { name: '搜索电台', exact: true }).focus();
  await page.clock.fastForward(31000);
  await expect(page.getByRole('main', { name: '沉浸收听', exact: true })).toHaveCount(0);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.clock.fastForward(31000);
  const immersive = page.getByRole('main', { name: '沉浸收听', exact: true });
  await expect(immersive).toBeVisible();
  expect(
    await immersive
      .locator('[data-playing]')
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe('none');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.clock.fastForward(31000);
  await expect(immersive).toHaveCount(0);
});
test('connects available native media-session actions to actual station playback without seek metadata', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const handlers = new Map<MediaSessionAction, MediaSessionActionHandler>();
    Object.defineProperty(window, '__mediaFixture', { value: handlers });
    if (!navigator.mediaSession) return;
    const session = navigator.mediaSession,
      original = session.setActionHandler.bind(session);
    session.setActionHandler = (action, handler) => {
      original(action, handler);
      if (handler) handlers.set(action, handler);
      else handlers.delete(action);
    };
  });
  await enter(page);
  await play(page);
  const actions = await page.evaluate(() => [
    ...(window as unknown as { __mediaFixture: Map<string, unknown> }).__mediaFixture.keys(),
  ]);
  if (!actions.length) {
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await expect(page.getByRole('status')).toHaveAttribute('data-state', 'paused');
    return;
  }
  expect(actions).not.toContain('seekto');
  await expect
    .poll(() => page.evaluate(() => navigator.mediaSession.metadata?.title))
    .toBe(first.name);
  for (const action of ['pause', 'play'] as const) {
    if (!actions.includes(action)) continue;
    await page.evaluate(
      (action) =>
        (
          window as unknown as {
            __mediaFixture: Map<string, (details: { action: string }) => void>;
          }
        ).__mediaFixture.get(action)?.({ action }),
      action,
    );
    await expect(page.getByRole('status')).toHaveAttribute(
      'data-state',
      action === 'play' ? 'playing' : 'paused',
    );
  }
  if (actions.includes('nexttrack')) {
    await page.evaluate(() =>
      (
        window as unknown as { __mediaFixture: Map<string, (details: { action: string }) => void> }
      ).__mediaFixture.get('nexttrack')?.({ action: 'nexttrack' }),
    );
    await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(first.name);
  }
});

for (const [label, width, height] of [
  ['desktop', 1440, 900],
  ['tablet', 768, 1024],
  ['mobile', 390, 844],
  ['narrow', 320, 700],
  ['landscape', 844, 390],
] as const) {
  test(`keeps settings and immersion usable at ${label} viewport`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await enter(page);
    await play(page);
    const dialog = await settings(page);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath('settings.png') });
    await dialog.getByRole('heading', { name: '键盘操作', exact: true }).scrollIntoViewIfNeeded();
    await expect(dialog.getByRole('heading', { name: '键盘操作', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '沉浸收听', exact: true }).click();
    const immersive = page.getByRole('main', { name: '沉浸收听', exact: true });
    await expect(immersive).toBeVisible();
    const heading = await immersive.getByRole('heading', { level: 1 }).boundingBox(),
      footer = await page.getByRole('contentinfo').boundingBox();
    expect(heading).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(heading!.y).toBeGreaterThanOrEqual(0);
    expect(heading!.y + heading!.height).toBeLessThanOrEqual(footer!.y);
    await page.screenshot({ path: info.outputPath('immersive.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.getByRole('button', { name: '返回探索', exact: true }).click();
    await page.getByRole('button', { name: '暂停', exact: true }).click();
  });
}
test('keeps English settings readable with doubled text on a phone viewport', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enter(page);
  await play(page);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.getByRole('button', { name: 'Listening settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Listening settings', exact: true });
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    const measurements = [...document.querySelectorAll<HTMLElement>('dialog, dialog *')].map(
      (element) => {
        const style = getComputedStyle(element);
        return { element, size: parseFloat(style.fontSize), line: parseFloat(style.lineHeight) };
      },
    );
    for (const { element, size, line } of measurements) {
      element.style.fontSize = size * 2 + 'px';
      if (Number.isFinite(line)) element.style.lineHeight = line * 2 + 'px';
    }
  });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: info.outputPath('settings-text200-en.png') });
  await dialog
    .getByRole('heading', { name: 'Keyboard controls', exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    dialog.getByRole('heading', { name: 'Keyboard controls', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Listening settings', exact: true })).toBeFocused();
});
