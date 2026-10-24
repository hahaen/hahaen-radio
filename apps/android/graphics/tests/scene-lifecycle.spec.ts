import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { glReport, installGLProbe } from '../../../web/tests/performance/webgl-probe.js';
import type { StationPreview } from '../../../../packages/contracts/src/scene.js';

const geography = fileURLToPath(new URL('../../../web/public/geography/', import.meta.url));
const snapshot = {
  station: null,
  playing: true,
  pinned: false,
  active: true,
  powerSave: false,
  scene: 'globe',
};
const stations: StationPreview[] = [0, 1].map((index) => ({
  id: `00000000-0000-4000-8000-00000000000${index}`,
  name: 'Graphics fixture',
  countryCode: null,
  region: null,
  city: null,
  nearbyCity: null,
  latitude: 25 + index,
  longitude: 80 + index,
  locationPrecision: 'coordinates',
  genre: 'general',
  languages: [],
  bitrate: 128,
  availability: 'available',
}));

async function send(page: Page, scene: string, active = true) {
  await page.evaluate(
    (value) => window.haenReceive?.({ version: 1, type: 'snapshot', snapshot: value }),
    { ...snapshot, scene, active },
  );
}

async function openScene(page: Page, initialScene = 'globe', landGate?: Promise<void>) {
  await installGLProbe(page);
  await page.addInitScript(() => {
    const messages: string[] = [];
    window.HaenNative = { postMessage: (value) => messages.push(JSON.parse(value).type) };
    Reflect.set(window, '__sceneMessages', messages);
  });
  await page.route('**/geography/**', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1)!;
    if (name === 'land.json') await landGate;
    return route.fulfill({ path: `${geography}${name}` });
  });
  await page.goto('./');
  await page.waitForFunction(() => typeof window.haenReceive === 'function');
  await page.evaluate((items) => {
    window.haenReceive?.({ version: 1, type: 'reset' });
    window.haenReceive?.({ version: 1, type: 'batch', items });
    window.haenReceive?.({ version: 1, type: 'complete' });
  }, stations);
  await send(page, initialScene);
  await expect.poll(async () => (await glReport(page))[0]?.draws ?? 0).toBeGreaterThan(0);
}

test('returns from immersion using the existing globe and bounded graphics resources', async ({
  page,
}, info) => {
  await openScene(page);
  await expect(page.locator('#scene canvas')).toHaveAttribute('data-marker-count', '2');
  const globe = await page.locator('canvas').elementHandle();
  const initial = (await glReport(page))[0]!;
  const returnTimes: number[] = [];
  for (let iteration = 0; iteration < 3; iteration++) {
    await send(page, 'ocean');
    await expect.poll(async () => (await glReport(page)).at(-1)?.draws ?? 0).toBeGreaterThan(0);
    const priorDraws = (await glReport(page))[0]!.draws;
    const returned = await page.evaluate(
      (value) =>
        new Promise<number>((resolve) => {
          const start = performance.now();
          const before = window.__haenGLReport()[0]!.draws;
          window.haenReceive?.({ version: 1, type: 'snapshot', snapshot: value });
          const painted = () => {
            if (window.__haenGLReport()[0]!.draws <= before) {
              requestAnimationFrame(painted);
              return;
            }
            requestAnimationFrame(() => resolve(performance.now() - start));
          };
          requestAnimationFrame(painted);
        }),
      snapshot,
    );
    returnTimes.push(returned);
    await expect.poll(async () => (await glReport(page)).filter((row) => !row.lost).length).toBe(2);
    expect(
      await globe!.evaluate((element) => element.isConnected),
      'return must retain the warm globe canvas',
    ).toBe(true);
    await expect.poll(async () => (await glReport(page))[0]!.draws).toBeGreaterThan(priorDraws);
    const report = await glReport(page);
    expect(report).toHaveLength(2);
    expect(report[0]!.losses).toBe(0);
    expect(report[0]!.resources.Program!.created).toBe(initial.resources.Program!.created);
    expect(report[0]!.resources.Texture!.created).toBe(initial.resources.Texture!.created);
    expect(report[0]!.resources.Buffer!.created).toBe(initial.resources.Buffer!.created);
    await expect(page.locator('canvas:visible')).toHaveCount(1);
  }
  await info.attach('return-to-following-frame-ms', {
    body: JSON.stringify(returnTimes),
    contentType: 'application/json',
  });
  await page.evaluate(() => {
    window.haenReceive?.({ version: 1, type: 'reset' });
    window.haenReceive?.({ version: 1, type: 'complete' });
  });
  await expect(page.locator('#scene canvas')).toHaveAttribute('data-marker-count', '0');
  await send(page, 'ocean');
  await send(page, 'globe');
  await expect(page.locator('#scene canvas')).toHaveAttribute('data-marker-count', '0');
  await page.evaluate(() => window.haenReceive?.({ version: 1, type: 'destroy' }));
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect.poll(async () => (await glReport(page)).every((row) => row.lost)).toBe(true);
  expect(
    (await glReport(page)).every((row) =>
      Object.values(row.resources).every((count) => count.live === 0),
    ),
  ).toBe(true);
});

test('stops hidden layers, shares one immersion renderer, and restores globe touch', async ({
  page,
}) => {
  await openScene(page);
  await send(page, 'ocean');
  await expect(page.locator('canvas')).toHaveCount(2);
  await page.waitForTimeout(200);
  const hiddenGlobe = (await glReport(page))[0]!.draws;
  await page.waitForTimeout(200);
  expect((await glReport(page))[0]!.draws).toBe(hiddenGlobe);
  expect(
    await page.evaluate(() => document.elementFromPoint(195, 350)?.closest('#scene')),
  ).toBeNull();
  for (const scene of ['mountains', 'aurora', 'ocean']) {
    await send(page, scene);
    await expect(page.locator('canvas:visible')).toHaveCount(1);
    expect(await glReport(page)).toHaveLength(2);
  }
  await page.evaluate(() => window.haenReceive?.({ version: 1, type: 'active', active: false }));
  await page.waitForTimeout(200);
  const background = (await glReport(page)).map((row) => row.draws);
  await page.waitForTimeout(200);
  expect((await glReport(page)).map((row) => row.draws)).toEqual(background);
  await expect(page.locator('canvas:visible')).toHaveCount(0);
  await page.evaluate(
    (value) => window.haenReceive?.({ version: 1, type: 'snapshot', snapshot: value }),
    { ...snapshot, playing: false, powerSave: true },
  );
  await expect(page.locator('#scene canvas')).toBeVisible();
  await page.waitForTimeout(200);
  const hiddenImmersion = (await glReport(page))[1]!.draws;
  const beforePinch = await page.locator('#scene canvas').screenshot();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: 160, y: 350 },
      { x: 230, y: 350 },
    ],
  });
  for (let step = 1; step <= 6; step++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: 160 - step * 10, y: 350 },
        { x: 230 + step * 10, y: 350 },
      ],
    });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(200);
  const zoomed = await page.locator('#scene canvas').screenshot();
  expect(beforePinch.equals(zoomed)).toBe(false);
  expect(
    await page.evaluate(() =>
      (Reflect.get(window, '__sceneMessages') as string[]).includes('interact'),
    ),
  ).toBe(true);
  expect((await glReport(page))[1]!.draws).toBe(hiddenImmersion);
  const cachedResources = (await glReport(page))[0]!.resources;
  for (let iteration = 0; iteration < 3; iteration++) {
    const beforeReturn = (await glReport(page))[0]!.draws;
    for (const scene of ['ocean', 'globe']) {
      await page.evaluate(
        (value) => window.haenReceive?.({ version: 1, type: 'snapshot', snapshot: value }),
        { ...snapshot, scene, playing: false, powerSave: true },
      );
    }
    await expect.poll(async () => (await glReport(page))[0]!.draws).toBeGreaterThan(beforeReturn);
    const resources = (await glReport(page))[0]!.resources;
    for (const kind of ['Buffer', 'Program', 'Texture'])
      expect(resources[kind]!.created, `power-saving returns must reuse ${kind}`).toBe(
        cachedResources[kind]!.created,
      );
  }
  await page.waitForTimeout(200);
  expect(
    zoomed.equals(await page.locator('#scene canvas').screenshot()),
    'the static camera framing survives immersion and return',
  ).toBe(true);
});

test('isolates a hidden globe context failure and lazily recreates only the restored cache', async ({
  page,
}) => {
  await openScene(page);
  await send(page, 'ocean');
  const globe = page.locator('#scene canvas');
  await globe.evaluate((element) => {
    const extension = (element as HTMLCanvasElement)
      .getContext('webgl2')!
      .getExtension('WEBGL_lose_context')!;
    Reflect.set(element, '__restoreContext', () => extension.restoreContext());
    extension.loseContext();
  });
  await expect.poll(async () => (await glReport(page))[0]!.lost).toBe(true);
  expect(
    await page.evaluate(() =>
      (Reflect.get(window, '__sceneMessages') as string[]).filter((type) => type === 'lost'),
    ),
  ).toHaveLength(0);
  await globe.evaluate((element) => (Reflect.get(element, '__restoreContext') as () => void)());
  await expect(globe).toHaveCount(0);
  await expect(page.locator('canvas:visible')).toHaveCount(1);
  await send(page, 'globe');
  await expect(page.locator('#scene canvas')).toBeVisible();
  await expect.poll(async () => (await glReport(page)).filter((row) => !row.lost).length).toBe(2);
  expect(
    await page.evaluate(() =>
      (Reflect.get(window, '__sceneMessages') as string[]).filter((type) => type === 'lost'),
    ),
  ).toHaveLength(0);
});

test('defers inactive context failure until that layer becomes active', async ({ page }) => {
  await openScene(page);
  await page.evaluate(() => window.haenReceive?.({ version: 1, type: 'active', active: false }));
  await page
    .locator('#scene canvas')
    .evaluate((element) =>
      (element as HTMLCanvasElement)
        .getContext('webgl2')!
        .getExtension('WEBGL_lose_context')!
        .loseContext(),
    );
  await expect.poll(async () => (await glReport(page))[0]!.lost).toBe(true);
  expect(
    await page.evaluate(() =>
      (Reflect.get(window, '__sceneMessages') as string[]).filter((type) => type === 'lost'),
    ),
  ).toHaveLength(0);
  await page.evaluate(() => window.haenReceive?.({ version: 1, type: 'active', active: true }));
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (Reflect.get(window, '__sceneMessages') as string[]).filter((type) => type === 'lost')
            .length,
      ),
    )
    .toBe(1);
});

test('does not revive a superseded globe creation when land finishes after switching away', async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await openScene(page, 'ocean', gate);
  await send(page, 'globe');
  await send(page, 'ocean');
  release();
  await page.waitForTimeout(250);
  expect(await glReport(page)).toHaveLength(1);
  await expect(page.locator('#scene canvas')).toHaveCount(0);
  await send(page, 'globe');
  await expect(page.locator('#scene canvas')).toBeVisible();
  await page.evaluate(() => window.haenReceive?.({ version: 1, type: 'destroy' }));
  await page.waitForTimeout(100);
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect.poll(async () => (await glReport(page)).every((row) => row.lost)).toBe(true);
});
