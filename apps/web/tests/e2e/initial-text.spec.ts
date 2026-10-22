import { expect, test } from '@playwright/test';
import { install } from './listening-fixture.js';

test.beforeEach(async ({ page }) => {
  await install(page);
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
});

test('reveals the whole interface gently on entry and reload', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const reload of [false, true]) {
    if (reload) await page.reload();
    else await page.goto('/');
    const shell = page.locator('#root > div');
    await expect(page.locator('h1')).toBeVisible();
    const entrance = await shell.evaluate((element) => {
      const animation = element
        .getAnimations()
        .find((item) => item.effect instanceof KeyframeEffect);
      return animation?.effect instanceof KeyframeEffect
        ? { frames: animation.effect.getKeyframes(), timing: animation.effect.getTiming() }
        : null;
    });
    expect(entrance).not.toBeNull();
    expect(Number(entrance!.frames[0]!.opacity)).toBe(0);
    expect(Number(entrance!.frames.at(-1)!.opacity)).toBe(1);
    expect(Number(entrance!.timing.duration)).toBeLessThanOrEqual(500);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(shell).toHaveCSS('animation-name', 'none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  }
});

test('late fonts do not change visible text widths', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/fonts/*.woff2*', async (route) => {
    await pending;
    await route.continue();
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('h1')).toBeVisible();
    // Let the browser's brief font block period expire before measuring visible fallback text.
    await page.waitForTimeout(300);
    const widths = () =>
      page.locator('h1, header a[aria-label="声屿 HAEN"]').evaluateAll((elements) =>
        elements.map((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return range.getBoundingClientRect().width;
        }),
      );
    const before = await widths();
    release();
    await page.evaluate(() => document.fonts.ready);
    const after = await widths();
    expect(after).toHaveLength(before.length);
    after.forEach((width, index) => expect(Math.abs(width - before[index]!)).toBeLessThan(0.25));
  } finally {
    release();
  }
});

test('keeps welcome text readable when fonts fail across screen sizes', async ({ page }, info) => {
  await page.route('**/fonts/*.woff2*', (route) => route.abort());
  await page.addInitScript(() => sessionStorage.removeItem('haen:exploring:v1'));
  for (const [width, height] of [
    [1440, 900],
    [768, 1024],
    [390, 844],
    [320, 700],
    [844, 390],
  ]) {
    await page.setViewportSize({ width: width!, height: height! });
    await page.goto('/');
    const title = page.getByRole('heading', { level: 1 });
    await expect(title).toBeVisible();
    await expect(page.getByRole('button', { name: '开始收听', exact: true })).toBeEnabled();
    await expect
      .poll(() => title.evaluate((element) => getComputedStyle(element.parentElement!).opacity))
      .toBe('1');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`entry-${width}x${height}.png`) });
  }
});

test('power saving skips the entrance and changing settings does not replay it', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'haen:personal:v1:scene',
      JSON.stringify({
        version: 1,
        value: { powerSave: true, immersion: 'aurora' },
      }),
    ),
  );
  await page.goto('/');
  const shell = page.locator('#root > div');
  await expect(shell).toHaveAttribute('data-power-save', 'true');
  await expect(shell).toHaveCSS('animation-duration', '0s');
  await expect(shell).toHaveCSS('opacity', '1');
  await page.getByRole('button', { name: '收听设置', exact: true }).click();
  await page.getByRole('checkbox', { name: '省电模式', exact: true }).uncheck();
  await expect(shell).toHaveCSS('opacity', '1');
});
