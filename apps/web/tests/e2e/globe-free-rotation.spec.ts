import { expect, test } from '@playwright/test';
import { first, install } from './listening-fixture.js';

test('keeps point selection working when pointer capture is released', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/globe-input-harness', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body style="margin:0"><div style="width:300px;height:300px"><div id="host" style="width:300px;height:300px"></div></div></body></html>',
    }),
  );
  await page.goto('/globe-input-harness');
  await page.evaluate(async () => {
    const globeUrl = '/src/graphics/globe.ts';
    const modelUrl = '/src/graphics/model.ts';
    const fixtureUrl = '/src/testing/stations.ts';
    const { createGlobe } = (await import(
      globeUrl
    )) as typeof import('../../src/graphics/globe.js');
    const { groupStations } = (await import(
      modelUrl
    )) as typeof import('../../src/graphics/model.js');
    const { testStation } = (await import(
      fixtureUrl
    )) as typeof import('../../src/testing/stations.js');
    const engine = createGlobe(
      document.getElementById('host')!,
      { version: 1, points: [], polygons: [] },
      {
        label: 'Point selection test',
        preview() {},
        lost() {},
        restored() {},
        ready() {
          document.title = 'ready';
        },
        pick(_group, reason) {
          document.title = `picked:${reason}`;
        },
      },
    );
    engine.setData(
      groupStations([
        {
          ...testStation(1),
          countryCode: null,
          latitude: 25,
          longitude: 80,
          locationPrecision: 'coordinates',
        },
      ]),
    );
  });
  await expect(page).toHaveTitle('ready');
  if (info.project.name === 'mobile-chromium') await page.touchscreen.tap(150, 150);
  else await page.mouse.click(150, 150);
  await expect(page).toHaveTitle('picked:click');
});

for (const direction of ['up', 'down', 'left', 'right'] as const) {
  test(`keeps rotating through repeated ${direction} drags`, async ({ page }, info) => {
    const phone = info.project.name === 'mobile-chromium';
    await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await install(page);
    await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
    await page.goto('/?station=' + first.id);
    const panel = page.getByTestId('globe-panel');
    await expect(panel).toHaveAttribute('data-state', 'ready');
    await page.getByRole('button', { name: '固定当前电台', exact: true }).click();
    const label = page.getByTestId('selected-station-label');
    const position = () =>
      label.evaluate((el) => {
        const matrix = new DOMMatrixReadOnly(el.style.transform);
        return [matrix.m41, matrix.m42];
      });
    const canvas = panel.locator('canvas');
    const box = (await canvas.boundingBox())!;
    const x = phone ? 190 : 950,
      y = phone ? 250 : 330;
    const dx = direction === 'left' ? -100 : direction === 'right' ? 100 : 0;
    const dy = direction === 'up' ? -100 : direction === 'down' ? 100 : 0;
    expect(x).toBeGreaterThan(box.x);
    const session = phone ? await page.context().newCDPSession(page) : null;
    try {
      for (let drag = 0; drag < 12; drag++) {
        const before = await position();
        if (session) {
          await session.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ x, y }],
          });
          for (let step = 1; step <= 10; step++)
            await session.send('Input.dispatchTouchEvent', {
              type: 'touchMove',
              touchPoints: [{ x: x + (dx * step) / 10, y: y + (dy * step) / 10 }],
            });
          await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else {
          await page.mouse.move(x, y);
          await page.mouse.down();
          await page.mouse.move(x + dx, y + dy, { steps: 10 });
          await page.mouse.up();
        }
        await expect
          .poll(
            async () => {
              const after = await position();
              return Math.hypot(after[0]! - before[0]!, after[1]! - before[1]!);
            },
            { message: `drag ${drag + 1} must still move the globe`, timeout: 1500 },
          )
          .toBeGreaterThan(2);
      }
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(first.name);
    } finally {
      await session?.detach();
    }
  });
}

test('keeps keyboard rotation continuous and resets the full orientation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await install(page);
  await page.goto('/?station=' + first.id);
  const panel = page.getByTestId('globe-panel');
  await expect(panel).toHaveAttribute('data-state', 'ready');
  const canvas = panel.locator('canvas');
  const label = page.getByTestId('selected-station-label');
  const position = () =>
    label.evaluate((el) => {
      const matrix = new DOMMatrixReadOnly(el.style.transform);
      return [matrix.m41, matrix.m42];
    });
  const initial = await position();
  for (let turn = 0; turn < 40; turn++) {
    const before = await label.getAttribute('style');
    await canvas.press('ArrowUp');
    await expect.poll(() => label.getAttribute('style')).not.toBe(before);
  }
  await canvas.press('ArrowRight');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await canvas.press('Home');
  await expect
    .poll(async () => {
      const after = await position();
      return Math.hypot(after[0]! - initial[0]!, after[1]! - initial[1]!);
    })
    .toBeLessThan(0.01);
});
