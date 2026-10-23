import { expect, test, type Page } from '@playwright/test';
import { first, install } from './listening-fixture.js';
import { glReport, installGLProbe } from '../performance/webgl-probe.js';

test('runs fullscreen environments on one audio session, settles motion and releases their graphics', async ({
  page,
}, info) => {
  test.setTimeout(60000);
  await page.setViewportSize(
    info.project.name === 'mobile-chromium'
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await install(page);
  await installGLProbe(page);
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (/THREE.WebGLProgram|VALIDATE_STATUS|shader error/i.test(message.text()))
      errors.push(message.text());
  });
  await page.goto('/?station=' + first.id);
  await expect(page.getByTestId('globe-panel')).toHaveAttribute('data-state', 'ready');
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
  await page.getByRole('button', { name: '沉浸收听', exact: true }).click();
  const immersive = page.getByRole('main', { name: '沉浸收听', exact: true });
  const art = immersive.locator('[data-effect]');
  await expect(art).toHaveAttribute('data-rendered', 'true');
  const reportIndex = (await glReport(page)).length - 1;
  const report = async () => (await glReport(page))[reportIndex]!;
  const start = (await report()).draws;
  await expect.poll(async () => (await report()).draws).toBeGreaterThan(start + 3);
  const viewport = page.viewportSize()!;
  const clip = {
    x: viewport.width * 0.2,
    y: viewport.height * 0.28,
    width: viewport.width * 0.6,
    height: viewport.height * 0.25,
  };
  const before = await page.screenshot({ clip });
  await page.waitForTimeout(500);
  expect(before.equals(await page.screenshot({ clip }))).toBe(false);
  for (const name of ['潮汐', '远山', '流光']) {
    await immersive.getByRole('button', { name, exact: true }).click();
    await expect(immersive.getByRole('button', { name, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('audio')).toHaveCount(1);
    await expect(immersive.getByRole('status')).toHaveAttribute('data-state', 'playing');
    await page.waitForTimeout(750);
    const activeFrame = await page.screenshot({ clip });
    await page.waitForTimeout(350);
    expect(activeFrame.equals(await page.screenshot({ clip }))).toBe(false);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await expect(immersive.getByRole('status')).toHaveAttribute('data-state', 'paused');
    await page.waitForTimeout(150);
    const stoppedDraws = (await report()).draws;
    const stillFrame = await page.screenshot({ clip });
    await page.waitForTimeout(250);
    expect((await report()).draws).toBe(stoppedDraws);
    // High-DPR Chromium can round composited gradient channels by one level
    // while the WebGL frame is unchanged; actual scene drawing must stay stopped.
    expect(await changedPixels(page, stillFrame, await page.screenshot({ clip }), 1)).toBe(0);
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await expect(immersive.getByRole('status')).toHaveAttribute('data-state', 'playing');
  }
  const simulated = await art.locator('canvas').evaluate((element) => {
    const extension = (element as HTMLCanvasElement)
      .getContext('webgl2')
      ?.getExtension('WEBGL_lose_context');
    if (!extension) return false;
    Reflect.set(element, Symbol.for('haen:test:immersion-loss'), extension);
    extension.loseContext();
    return true;
  });
  if (simulated) {
    await expect(art).toHaveAttribute('data-rendered', 'false');
    await expect(art.locator('svg:visible')).toBeVisible();
    await expect(art.locator('canvas')).toBeHidden();
    await expect(immersive.getByRole('status')).toHaveAttribute('data-state', 'playing');
    await art.locator('canvas').evaluate((element) => {
      (
        Reflect.get(element, Symbol.for('haen:test:immersion-loss')) as WEBGL_lose_context
      ).restoreContext();
      Reflect.deleteProperty(element, Symbol.for('haen:test:immersion-loss'));
    });
    await expect(art).toHaveAttribute('data-rendered', 'true', { timeout: 10000 });
  }
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.waitForTimeout(850);
  const paused = (await report()).draws;
  await page.waitForTimeout(250);
  expect((await report()).draws).toBe(paused);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect.poll(async () => (await report()).draws).toBeGreaterThan(paused + 3);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(150);
  const reduced = (await report()).draws;
  await page.waitForTimeout(250);
  expect((await report()).draws).toBe(reduced);
  await page.getByRole('button', { name: '返回探索', exact: true }).click();
  await expect.poll(async () => (await report()).lost).toBe(true);
  expect(Object.values((await report()).resources).every((count) => count.live === 0)).toBe(true);
  await page.getByRole('button', { name: '收听设置', exact: true }).click();
  await page.getByRole('checkbox', { name: '省电模式', exact: true }).check();
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  await page.getByRole('button', { name: '沉浸收听', exact: true }).click();
  await expect(art).toHaveAttribute('data-rendered', 'true');
  const poweredIndex = (await glReport(page)).length - 1;
  await page.waitForTimeout(150);
  const powered = (await glReport(page))[poweredIndex]!.draws;
  await page.waitForTimeout(250);
  expect((await glReport(page))[poweredIndex]!.draws).toBe(powered);
  await page.getByRole('button', { name: '返回探索', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '收听设置', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '沉浸画面', exact: true })).toHaveValue('aurora');
  await expect(page.getByRole('checkbox', { name: '省电模式', exact: true })).toBeChecked();
  expect(errors).toEqual([]);
});

test('keeps a full scene and playback controls when WebGL is unavailable', async ({ page }) => {
  await install(page);
  await page.addInitScript(() => {
    localStorage.setItem('haen:language:v1', 'zh');
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...args: unknown[]
    ) {
      if (/^webgl/.test(type)) return null;
      return get.apply(this, [type, ...args] as Parameters<typeof get>);
    } as typeof get;
  });
  await page.goto('/?station=' + first.id);
  await page.getByRole('button', { name: '沉浸收听', exact: true }).click();
  const art = page.getByRole('main', { name: '沉浸收听', exact: true }).locator('[data-effect]');
  await expect(art).toHaveAttribute('data-rendered', 'false');
  await expect(art.locator('svg:visible')).toBeVisible();
  await page.getByRole('button', { name: '潮汐', exact: true }).click();
  await expect(art).toHaveAttribute('data-effect', 'ocean');
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    for (const name of ['潮汐', '远山']) {
      await page.getByRole('button', { name, exact: true }).click();
      await expect(art.locator('svg:visible')).toHaveCount(1);
      await expect(art.locator('svg:visible path')).not.toHaveCount(0);
      await expect(page.getByRole('button', { name: '返回探索', exact: true })).toBeInViewport();
    }
  }
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
});

test('shows perceptible motion in phone water and mountain fog, beyond sky twinkling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await install(page);
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
  await page.goto('/?station=' + first.id);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
  await page.getByRole('button', { name: '沉浸收听', exact: true }).click();
  const immersive = page.getByRole('main', { name: '沉浸收听', exact: true });
  await expect(immersive.locator('[data-effect]')).toHaveAttribute('data-rendered', 'true');
  for (const name of ['潮汐', '远山']) {
    await immersive.getByRole('button', { name, exact: true }).click();
    await page.waitForTimeout(850);
    // Sample the environment itself, excluding stars, labels and transport controls.
    const clip =
      name === '潮汐'
        ? { x: 0, y: 330, width: 390, height: 110 }
        : { x: 0, y: 210, width: 390, height: 200 };
    const before = await page.screenshot({ clip });
    await page.waitForTimeout(2000);
    const after = await page.screenshot({ clip });
    const movingFraction = await changedPixels(page, before, after, 4);
    expect(movingFraction, `${name} should visibly change within two seconds`).toBeGreaterThan(
      0.01,
    );
  }
});

async function changedPixels(page: Page, before: Buffer, after: Buffer, tolerance: number) {
  return page.evaluate(
    async ({ before, after, tolerance }) => {
      const frames: Uint8ClampedArray[] = [];
      for (const data of [before, after]) {
        const image = new Image();
        image.src = 'data:image/png;base64,' + data;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        frames.push(context.getImageData(0, 0, canvas.width, canvas.height).data);
      }
      const [a, b] = frames as [Uint8ClampedArray, Uint8ClampedArray];
      if (a.length !== b.length) throw new Error('Frame dimensions changed during comparison');
      let changed = 0;
      for (let i = 0; i < a.length; i += 4) {
        const difference = Math.max(
          Math.abs(a[i]! - b[i]!),
          Math.abs(a[i + 1]! - b[i + 1]!),
          Math.abs(a[i + 2]! - b[i + 2]!),
        );
        if (difference > tolerance) changed++;
      }
      return changed / (a.length / 4);
    },
    { before: before.toString('base64'), after: after.toString('base64'), tolerance },
  );
}
