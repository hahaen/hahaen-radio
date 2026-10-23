import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { first, install } from './listening-fixture.js';

test('keeps globe overlays out of text selection during phone dragging', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await install(page);
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
  await page.goto('/?station=' + first.id);
  const panel = page.getByTestId('globe-panel');
  await expect(panel).toHaveAttribute('data-state', 'ready');
  const selection = panel.locator('[class*="selectionLabel"]');
  await expect(selection).toHaveCount(1);
  expect(await selection.evaluate((el) => getComputedStyle(el).userSelect)).toBe('none');
  const canvas = panel.locator('canvas');
  expect(await canvas.evaluate((el) => getComputedStyle(el).touchAction)).toBe('none');
});

test('uses a quiet non-red focus indicator on phone settings', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await install(page);
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
  await page.goto('/?station=' + first.id);
  for (const name of ['收听设置', '我的收听', '查找电台', '关于与帮助']) {
    await page.getByRole('button', { name, exact: true }).click();
    const close = page.getByRole('button', { name: '关闭面板', exact: true });
    await expect(close).toBeVisible();
    await page.keyboard.press('Tab');
    await close.focus();
    expect(await close.evaluate((el) => getComputedStyle(el).outlineColor)).toBe(
      'rgb(145, 170, 160)',
    );
    expect(await close.evaluate((el) => getComputedStyle(el).outlineWidth)).toBe('2px');
    if (name === '收听设置')
      await page.screenshot({ path: info.outputPath('settings-focus.png'), scale: 'css' });
    await page.keyboard.press('Escape');
  }
});

for (const region of [null, '内蒙古自治区']) {
  test(`keeps ${region ?? 'country'} location and precision hint beside phone details`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await install(page);
    await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
    const { testScene } = await import('../../src/testing/stations.js');
    const stations = [first, { ...first, id: '00000000-0000-4000-8000-000000000002' }].map((s) => ({
      ...s,
      countryCode: 'CN',
      region,
    }));
    const scene = testScene(stations);
    await page.route('**/api/v1/catalog**', (route) =>
      route.fulfill({
        json: route.request().url().includes('/chunks/') ? scene.chunk : scene.manifest,
      }),
    );
    await page.route(/\/api\/v1\/stations\/[0-9a-f-]{36}$/, (route) =>
      route.fulfill({ json: stations[0] }),
    );
    await page.goto('/?station=' + first.id);
    const panel = page.getByTestId('globe-panel');
    await expect(panel).toHaveAttribute('data-state', 'ready');
    const player = page.getByRole('contentinfo');
    const label = region ? '内蒙古自治区 · 省/州级大致位置' : /^中国(?:大陆)? · 国家级位置$/;
    const location = player.getByRole('button', { name: label, exact: true });
    const hint = player.getByText(
      region
        ? '仅确定省/州；空心圆汇总电台，不表示具体台址。'
        : '仅确定国家；空心圆汇总电台，不表示具体台址。',
      { exact: true },
    );
    for (const width of [390, 320, 375]) {
      await page.setViewportSize({
        width,
        height: width === 375 ? 667 : width === 320 ? 700 : 844,
      });
      await expect(location).toBeVisible();
      await expect(hint).toBeInViewport();
      await expect(location).toBeInViewport();
      const a = (await player.locator('summary').boundingBox())!,
        b = (await location.boundingBox())!,
        h = (await hint.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(a.x + a.width);
      expect(Math.abs(a.y + a.height / 2 - b.y - b.height / 2)).toBeLessThan(2);
      const metadata = (await player.locator('[class*=metadata]').boundingBox())!;
      expect(
        a.y - metadata.y - metadata.height,
        'Precision copy must not add a separate blank row on the left',
      ).toBeLessThan(24);
      expect(h.x).toBeGreaterThan(a.x);
      expect(h.y + h.height).toBeLessThanOrEqual(b.y + 1);
      await expect(panel.getByRole('button', { name: label, exact: true })).toHaveCount(0);
      await player.locator('summary').click();
      await expect(player.getByText('地图位置', { exact: true })).toBeVisible();
      expect(await player.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await player.locator('summary').click();
      await location.click();
      await expect(page.getByRole('dialog', { name: label, exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(location).toBeFocused();
      await page.screenshot({
        path: info.outputPath(`${region ? 'region' : 'country'}-${width}.png`),
        scale: 'css',
      });
    }
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    const summaryBox = (await player.locator('summary').boundingBox())!;
    const metadataBox = (await player.locator('[class*=metadata]').boundingBox())!;
    expect(summaryBox.y - metadataBox.y - metadataBox.height).toBeLessThan(24);
    await page.screenshot({ path: info.outputPath('compact-en.png'), scale: 'css' });
  });
}

test('drags the phone globe repeatedly without selecting overlay text or changing the station', async ({
  page,
  browserName,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await install(page);
  await page.goto('/?station=' + first.id);
  const panel = page.getByTestId('globe-panel');
  await expect(panel).toHaveAttribute('data-state', 'ready');
  const label = page.getByTestId('selected-station-label');
  await expect(label).toHaveAttribute('data-visible', 'true');
  const before = await label.getAttribute('style');
  if (browserName === 'chromium') {
    const session = await page.context().newCDPSession(page);
    for (let i = 0; i < 4; i++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: 130, y: 240 }],
      });
      for (let x = 140; x <= 240; x += 10)
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x, y: 250 }],
        });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    await session.detach();
  } else {
    for (let i = 0; i < 4; i++) {
      await page.mouse.move(130, 240);
      await page.mouse.down();
      await page.mouse.move(240, 250, { steps: 12 });
      await page.mouse.up();
    }
  }
  await expect.poll(() => label.getAttribute('style')).not.toBe(before);
  expect(await page.evaluate(() => getSelection()?.toString())).toBe('');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(first.name);
});

test('keeps genre selection distinct with a dark surface on phone and desktop', async ({
  page,
}, info) => {
  await install(page);
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
  await page.goto('/?station=' + first.id);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const genres = page.getByRole('navigation', { name: '流派' });
  for (const [width, height] of [
    [390, 844],
    [1440, 900],
    [768, 1024],
    [320, 700],
    [844, 390],
  ]) {
    await page.setViewportSize({ width: width!, height: height! });
    const all = genres.getByRole('button', { name: /全部流派/ });
    await all.click();
    await expect(all).toHaveAttribute('aria-pressed', 'true');
    const style = await all.evaluate((el) => {
      const s = getComputedStyle(el);
      return { background: s.backgroundColor, text: s.color, border: s.borderTopColor };
    });
    expect(style.background).toBe('rgb(20, 41, 35)');
    expect(style.text).toBe('rgb(245, 241, 232)');
    const jazz = genres.getByRole('button', { name: /爵士/ });
    await jazz.click();
    await expect(jazz).toHaveAttribute('aria-pressed', 'true');
    await expect(all).toHaveAttribute('aria-pressed', 'false');
    await all.click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`genres-${width}.png`), scale: 'css' });
  }
});

test('audits phone and desktop controls after map hint relocation', async ({ page }) => {
  await install(page);
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
  await page.goto('/?station=' + first.id);
  await expect(page.getByTestId('globe-panel')).toHaveAttribute('data-state', 'ready');
  await page.evaluate(() => document.fonts.ready);
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    const report = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      report.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((n) => n.target) })),
    ).toEqual([]);
  }
});

test('keeps long station titles and expanded details usable with compact metadata', async ({
  page,
}, info) => {
  await install(page);
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
  const name = '广西文艺广播 FM950广西音乐台';
  await page.route('**/api/v1/stations/' + first.id, (route) =>
    route.fulfill({ json: { ...first, name } }),
  );
  await page.goto('/?station=' + first.id);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const player = page.getByRole('contentinfo');
  for (const [width, height] of [
    [390, 844],
    [320, 700],
    [375, 667],
    [768, 1024],
    [1440, 900],
    [844, 390],
  ]) {
    await page.setViewportSize({ width: width!, height: height! });
    await expect(player.getByRole('heading', { level: 1 })).toHaveText(name);
    await expect(player.getByRole('button', { name: '播放', exact: true })).toBeInViewport();
    const summary = player.locator('summary');
    await summary.click();
    await expect(player.getByText('地图位置', { exact: true })).toBeVisible();
    expect(await player.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await summary.click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`compact-long-${width}.png`), scale: 'css' });
  }
});
