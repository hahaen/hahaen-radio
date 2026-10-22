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
