import { expect, test } from '@playwright/test';
import { first, install } from './listening-fixture.js';

test('draws the zoomed globe behind the left listening area without a crop edge', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await install(page);
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?station=' + first.id);
  const panel = page.getByTestId('globe-panel');
  await expect(panel).toHaveAttribute('data-state', 'ready');
  const canvas = panel.locator('canvas');
  await expect(canvas).toHaveAttribute('data-relief', /^(ready|unavailable)$/);
  await page.getByRole('button', { name: '固定当前电台', exact: true }).click();
  await canvas.press('Home');
  await expect.poll(async () => (await canvas.boundingBox())!.x).toBe(0);
  expect((await canvas.boundingBox())!.width).toBe(1440);
  // This patch is behind the transparent listening column, to the left of the former crop.
  const clip = { x: 100, y: 170, width: 40, height: 40 };
  const before = await page.screenshot({ clip });
  for (let step = 0; step < 10; step++) {
    await canvas.press('+');
    if (step === 2) await page.screenshot({ path: info.outputPath('desktop-zoomed.png') });
  }
  await page.screenshot({ path: info.outputPath('desktop-max-zoom.png') });
  const after = await page.screenshot({ clip });
  const difference = await page.evaluate(
    async ([before, after]) => {
      const pixels = async (base64: string) => {
        const bytes = Uint8Array.from(atob(base64), (value) => value.charCodeAt(0));
        const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const surface = document.createElement('canvas');
        surface.width = image.width;
        surface.height = image.height;
        const context = surface.getContext('2d')!;
        context.drawImage(image, 0, 0);
        image.close();
        return context.getImageData(0, 0, surface.width, surface.height).data;
      };
      const a = await pixels(before!),
        b = await pixels(after!);
      let sum = 0;
      for (let i = 0; i < a.length; i++) if (i % 4 !== 3) sum += Math.abs(a[i]! - b[i]!);
      return sum / (a.length * 0.75);
    },
    [before.toString('base64'), after.toString('base64')],
  );
  expect(difference).toBeGreaterThan(2);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'paused');
  for (const [width, height] of [
    [1920, 1080],
    [1024, 1200],
    [768, 1024],
    [390, 844],
    [320, 700],
    [844, 390],
  ]) {
    await page.setViewportSize({ width: width!, height: height! });
    await expect.poll(async () => (await canvas.boundingBox())!.width).toBe(width);
    expect((await canvas.boundingBox())!.x).toBe(0);
    await expect(page.getByRole('button', { name: '播放', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`zoomed-${width}x${height}.png`) });
  }
  expect(errors).toEqual([]);
});

test('extends the phone globe above and below its composition during zoom', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await install(page);
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
  await page.goto('/?station=' + first.id);
  const panel = page.getByTestId('globe-panel');
  await expect(panel).toHaveAttribute('data-state', 'ready');
  const canvas = panel.locator('canvas');
  await expect(canvas).toHaveAttribute('data-relief', /^(ready|unavailable)$/);
  await page.getByRole('button', { name: '固定当前电台', exact: true }).click();
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 320, height: 700 },
  ]) {
    await page.setViewportSize(viewport);
    await canvas.press('Home');
    await expect.poll(async () => (await canvas.boundingBox())!.y).toBe(0);
    expect(await canvas.boundingBox()).toEqual({ x: 0, y: 0, ...viewport });
    const stage = await canvas.evaluate((element) => {
      const box = element.parentElement!.parentElement!.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom };
    });
    const patches = [
      { x: 2, y: Math.max(2, stage.top - 32), width: 12, height: 24 },
      { x: 2, y: stage.bottom + 12, width: 12, height: 24 },
    ];
    const before = await Promise.all(patches.map((clip) => page.screenshot({ clip })));
    for (let i = 0; i < 12; i++) await canvas.press('+');
    for (let index = 0; index < patches.length; index++) {
      const after = await page.screenshot({ clip: patches[index]! });
      expect(before[index]!.equals(after), 'The globe must draw beyond its old crop edge').toBe(
        false,
      );
    }
    await page.screenshot({
      path: info.outputPath(`phone-zoom-${viewport.width}.png`),
      scale: 'css',
    });
    for (let i = 0; i < 12; i++) await canvas.press('-');
    await expect(page.getByRole('button', { name: '播放', exact: true })).toBeInViewport();
    await page.screenshot({
      path: info.outputPath(`phone-wide-${viewport.width}.png`),
      scale: 'css',
    });
  }
});

test('places phone map information after Share and preserves its dismissal and focus', async ({
  page,
  browserName,
}, info) => {
  await install(page);
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?station=' + first.id);
  const toggle = page.getByRole('button', { name: '地图信息', exact: true });
  const share = page.getByRole('button', { name: '分享', exact: true });
  const details = page.getByRole('region', { name: '地图信息', exact: true });
  for (const width of [390, 320, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 667 : 844 });
    await expect(toggle).toHaveCount(1);
    await expect(
      page.getByRole('contentinfo').getByRole('button', { name: '地图信息', exact: true }),
    ).toBeVisible();
    const a = (await share.boundingBox())!,
      b = (await toggle.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(a.x + a.width);
    expect(b.x - a.x - a.width).toBeLessThanOrEqual(8);
    expect(Math.abs(a.y - b.y)).toBeLessThan(1);
    expect(b.width).toBeGreaterThanOrEqual(44);
    const volume = (await page.getByRole('button', { name: '静音', exact: true }).boundingBox())!;
    expect(b.x + b.width).toBeLessThanOrEqual(volume.x);
    await share.focus();
    // macOS WebKit uses Option+Tab to include buttons in sequential keyboard navigation.
    await page.keyboard.press(
      browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab',
    );
    await expect(toggle).toBeFocused();
    await toggle.press('Enter');
    await expect(details).toBeVisible();
    await toggle.click();
    await expect(details).toBeHidden();
    await toggle.click();
    await details.getByRole('button', { name: '关闭面板', exact: true }).click();
    await expect(toggle).toBeFocused();
    await toggle.click();
    await toggle.press('Escape');
    await expect(details).toBeHidden();
    await expect(toggle).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`phone-info-${width}.png`), scale: 'css' });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(
    page.getByTestId('globe-panel').getByRole('button', { name: '地图信息', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('contentinfo').getByRole('button', { name: '地图信息', exact: true }),
  ).toHaveCount(0);
});

test('places the phone country group beside station details as an unframed text action', async ({
  page,
}, info) => {
  await install(page);
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?station=' + first.id);
  for (const width of [390, 320, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 667 : 844 });
    const player = page.getByRole('contentinfo');
    const country = player.getByRole('button', { name: '英国 · 国家级位置', exact: true });
    await expect(country).toBeVisible();
    await expect(
      page
        .getByTestId('globe-panel')
        .getByRole('button', { name: '英国 · 国家级位置', exact: true }),
    ).toHaveCount(0);
    const summary = player.locator('summary');
    const a = (await summary.boundingBox())!,
      b = (await country.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(a.x + a.width);
    expect(Math.abs(a.y + a.height / 2 - b.y - b.height / 2)).toBeLessThan(2);
    const style = await country.evaluate((element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return {
        size: style.fontSize,
        border: style.borderTopWidth,
        background: style.backgroundColor,
        hittable: element.contains(
          document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
        ),
      };
    });
    expect(style).toEqual({
      size: await summary.evaluate((element) => getComputedStyle(element).fontSize),
      border: '0px',
      background: 'rgba(0, 0, 0, 0)',
      hittable: true,
    });
    await country.focus();
    await country.press('Enter');
    await expect(
      page.getByRole('dialog', { name: '英国 · 国家级位置', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(country).toBeFocused();
    await summary.click();
    await expect(player.getByText('地图位置', { exact: true })).toBeVisible();
    expect(await player.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await summary.click();
    await page.screenshot({ path: info.outputPath(`phone-country-${width}.png`), scale: 'css' });
  }
  await page.setViewportSize({ width: 320, height: 700 });
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  const english = page
    .getByRole('contentinfo')
    .getByRole('button', { name: /Country-level location/ });
  await expect(english).toBeInViewport();
  expect(await english.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  await page.screenshot({ path: info.outputPath('phone-country-en.png'), scale: 'css' });
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(
    page.getByTestId('globe-panel').getByRole('button', { name: '英国 · 国家级位置', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('contentinfo').getByRole('button', { name: '英国 · 国家级位置', exact: true }),
  ).toHaveCount(0);
});
