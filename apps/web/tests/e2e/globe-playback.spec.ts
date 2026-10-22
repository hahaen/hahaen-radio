import { encodeSceneEntry } from '@haen/contracts';
import { expect, test } from '@playwright/test';
import { installScale, stations } from './scale-fixture.js';
import { testScene } from '../../src/testing/stations.js';
import { first, install } from './listening-fixture.js';
import { glReport, installGLProbe } from '../performance/webgl-probe.js';

test('animates station lights during playback and settles when paused or motion is reduced', async ({
  page,
}, info) => {
  test.setTimeout(60000);
  await page.setViewportSize(
    info.project.name === 'mobile-chromium'
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await installScale(page);
  // Synthetic global coordinates must not be normalized to a fixture country centroid.
  await page.route('**/api/v1/catalog/**/chunks/*', (route) => {
    const index = Number(new URL(route.request().url()).pathname.split('/').at(-1));
    const scene = testScene(stations.slice(index * 1000, (index + 1) * 1000));
    return route.fulfill({
      json: {
        ...scene.chunk,
        index,
        entries: stations
          .slice(index * 1000, (index + 1) * 1000)
          .map((station) =>
            encodeSceneEntry({ ...station, countryCode: null, locationPrecision: 'coordinates' }),
          ),
      },
    });
  });
  await page.route('**/api/v1/stations/' + stations[20017]!.id, (route) =>
    route.fulfill({
      json: { ...stations[20017]!, countryCode: null, locationPrecision: 'coordinates' },
    }),
  );
  await installGLProbe(page);
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
  const errors: string[] = [];
  page.on('console', (message) => {
    if (/THREE.WebGLProgram|VALIDATE_STATUS|shader error/i.test(message.text()))
      errors.push(message.text());
  });
  await page.goto('/?station=' + stations[20017]!.id);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(stations[20017]!.name);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
  const panel = page.getByTestId('globe-panel');
  await expect(panel).toHaveAttribute('data-state', 'ready', { timeout: 15000 });
  await expect(panel.locator('canvas')).toHaveAttribute('data-relief', /^(ready|unavailable)$/, {
    timeout: 15000,
  });
  await expect(page.getByTestId('selected-station-label')).toHaveAttribute('data-visible', 'true');
  await page.waitForTimeout(800);
  await page.screenshot({ path: info.outputPath('station-lights.png') });
  const report = async () => (await glReport(page))[0]!;
  const start = (await report()).draws;
  await expect.poll(async () => (await report()).draws).toBeGreaterThan(start + 3);
  const bounds = (await panel.locator('canvas').boundingBox())!;
  const clip = {
    x: bounds.x + bounds.width / 2 - 48,
    y: bounds.y + bounds.height / 2 - 48,
    width: 96,
    height: 96,
  };
  const before = await page.screenshot({ clip });
  await page.waitForTimeout(650);
  const after = await page.screenshot({ clip });
  expect(before.equals(after)).toBe(false);
  const neighbors = { ...clip, x: clip.x - 60, y: clip.y - 60, width: 48, height: 48 };
  const neighborsBefore = await page.screenshot({ clip: neighbors });
  await page.waitForTimeout(800);
  expect(neighborsBefore.equals(await page.screenshot({ clip: neighbors }))).toBe(false);
  for (const [width, height] of [
    [1440, 900],
    [768, 1024],
    [390, 844],
    [320, 700],
    [844, 390],
  ]) {
    await page.setViewportSize({ width: width!, height: height! });
    await page.screenshot({ path: info.outputPath(`playing-${width}x${height}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.waitForTimeout(300);
  const paused = (await report()).draws;
  await page.waitForTimeout(250);
  expect((await report()).draws).toBe(paused);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect.poll(async () => (await report()).draws).toBeGreaterThan(paused + 3);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(800);
  const reduced = (await report()).draws;
  await page.waitForTimeout(250);
  expect((await report()).draws).toBe(reduced);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: '收听设置', exact: true }).click();
  await page.getByRole('checkbox', { name: '省电模式', exact: true }).check();
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  await page.waitForTimeout(300);
  const powered = (await report()).draws;
  await page.waitForTimeout(250);
  expect((await report()).draws).toBe(powered);
  await expect(panel.locator('canvas')).toHaveAttribute('data-marker-count', '30000');
  expect(errors).toEqual([]);
});

test('breathes the globe rim even without plotted stations', async ({ page }) => {
  test.setTimeout(60000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await install(page);
  await installGLProbe(page);
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
  const station = {
    ...first,
    countryCode: null,
    latitude: null,
    longitude: null,
    locationPrecision: 'country',
    streams: [{ ...first.streams[0]!, url: 'https://media.haen.test/tone.mp3' }],
  };
  const scene = testScene([]);
  scene.manifest.chunks = [];
  await page.route('**/api/v1/catalog**', (route) =>
    route.fulfill({
      json: route.request().url().includes('/chunks/') ? scene.chunk : scene.manifest,
    }),
  );
  await page.route('**/api/v1/stations/**', (route) => route.fulfill({ json: station }));
  await page.goto('/?station=' + station.id);
  const panel = page.getByTestId('globe-panel');
  await expect(panel).toHaveAttribute('data-state', 'ready', { timeout: 15000 });
  const canvas = panel.locator('canvas');
  await expect(canvas).toHaveAttribute('data-marker-count', '0');
  await expect(canvas).toHaveAttribute('data-relief', /^(ready|unavailable)$/, { timeout: 15000 });
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
  // Hide surrounding DOM decoration to compare only the empty globe's rendered pixels.
  const isolation = await page.addStyleTag({
    content: 'body * { visibility: hidden !important; } canvas { visibility: visible !important; }',
  });
  const before = await canvas.screenshot();
  await page.waitForTimeout(800);
  expect(before.equals(await canvas.screenshot())).toBe(false);
  await isolation.evaluate((element) => element.parentNode?.removeChild(element));
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.waitForTimeout(300);
  const draws = (await glReport(page))[0]!.draws;
  await page.waitForTimeout(300);
  expect((await glReport(page))[0]!.draws).toBe(draws);
});
