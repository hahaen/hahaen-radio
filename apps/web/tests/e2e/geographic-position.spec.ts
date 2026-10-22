import { test, expect } from '@playwright/test';
import { install, selectStation } from './listening-fixture.js';
import { testScene, testStation } from '../../src/testing/stations.js';

async function installPositionProbe(page: Parameters<typeof install>[0], count: number) {
  await page.addInitScript((countExpected) => {
    localStorage.setItem('haen:language:v1', 'zh');
    const draw = WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays = function (mode, first, count) {
      draw.call(this, mode, first, count);
      if (mode !== this.POINTS || count !== countExpected) return;
      const program = this.getParameter(this.CURRENT_PROGRAM) as WebGLProgram | null;
      if (!program || this.getAttribLocation(program, 'approximate') < 0) return;
      const index = this.getAttribLocation(program, 'position');
      const buffer = this.getVertexAttrib(
        index,
        this.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING,
      ) as WebGLBuffer;
      const previous = this.getParameter(this.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
      this.bindBuffer(this.ARRAY_BUFFER, buffer);
      const positions = new Float32Array(count * 3);
      this.getBufferSubData(this.ARRAY_BUFFER, 0, positions);
      this.bindBuffer(this.ARRAY_BUFFER, previous);
      Reflect.set(this.canvas, 'stationPositions', Array.from(positions));
      Reflect.set(
        this.canvas,
        'stationDraws',
        Number(Reflect.get(this.canvas, 'stationDraws') ?? 0) + 1,
      );
    };
  }, count);
}

test('renders geographically aligned station lights and keeps exact points fixed during expansion', async ({
  page,
}, info) => {
  const mobile = info.project.name === 'mobile-chromium';
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await install(page);
  await installPositionProbe(page, 10);
  const located = [
    { code: 'CN', lat: 39.9, lon: 116.4, name: 'Beijing' },
    { code: 'US', lat: 40.71, lon: -74.01, name: 'New York' },
    { code: 'GB', lat: 51.5, lon: -0.1, name: 'London' },
    { code: 'AU', lat: -33.87, lon: 151.21, name: 'Sydney' },
    { code: 'CH', lat: 47.5, lon: 7.6, name: 'Basel A' },
    { code: 'CH', lat: 47.5, lon: 7.6, name: 'Basel B' },
  ].map((s, i) => ({
    ...testStation(i + 1),
    name: s.name,
    countryCode: s.code,
    latitude: s.lat,
    longitude: s.lon,
    locationPrecision: 'coordinates' as const,
  }));
  const approximate = ['CN', 'US', 'GB', 'AU'].map((code, i) => ({
    ...testStation(i + 20),
    countryCode: code,
  }));
  const conflicting = {
    ...testStation(30),
    name: 'Conflicting US station',
    countryCode: 'US',
    latitude: 39.9,
    longitude: 116.4,
    locationPrecision: 'coordinates' as const,
  };
  const entries = [...located, ...approximate, conflicting];
  for (const station of entries) station.streams[0]!.url = 'https://media.haen.test/tone.mp3';
  const scene = testScene(entries);
  await page.route('**/api/v1/catalog**', (route) =>
    route.fulfill({
      json: route.request().url().includes('/chunks/') ? scene.chunk : scene.manifest,
    }),
  );
  await page.route(/\/api\/v1\/stations\/[0-9a-f-]{36}$/, (route) =>
    route.fulfill({ json: entries.find((s) => s.id === route.request().url().split('/').at(-1)) }),
  );
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./?station=' + located[0]!.id);
  const panel = page.getByTestId('globe-panel');
  await expect(panel).toHaveAttribute('data-state', 'ready');
  const canvas = panel.locator('canvas');
  const positions = async () =>
    canvas.evaluate((el) => Reflect.get(el, 'stationPositions') as number[] | undefined);
  await expect.poll(positions).toHaveLength(30);
  const points = (values: number[]) =>
    Array.from({ length: 10 }, (_, i) => {
      const [x, y, z] = values.slice(i * 3, i * 3 + 3) as [number, number, number];
      return {
        lat: (Math.asin(y / Math.hypot(x, y, z)) * 180) / Math.PI,
        lon: (Math.atan2(x, z) * 180) / Math.PI,
      };
    });
  const before = (await positions())!;
  for (let i = 0; i < before.length; i += 3)
    expect(Math.hypot(...before.slice(i, i + 3))).toBeCloseTo(1.001, 6);
  const drawn = points(before);
  // Renderer ordering follows geographic groups, so compare exact coordinates by position.
  for (const station of located)
    expect(
      drawn.some(
        (p) =>
          Math.abs(p.lat - station.latitude) < 0.00001 &&
          Math.abs(p.lon - station.longitude) < 0.00001,
      ),
    ).toBe(true);
  expect(
    drawn.filter((p) => Math.abs(p.lat - 39.9) < 0.00001 && Math.abs(p.lon - 116.4) < 0.00001),
  ).toHaveLength(1);
  for (const [left, bottom, right, top, count] of [
    [73, 18, 135, 54, 2],
    [-180, 18, -60, 72, 2],
    [-9, 49, 3, 61, 2],
    [112, -45, 154, -10, 2],
  ])
    expect(
      drawn.filter((p) => p.lon >= left! && p.lon <= right! && p.lat >= bottom! && p.lat <= top!),
    ).toHaveLength(count!);
  await page.screenshot({ path: info.outputPath('beijing-station-lights.png') });
  await selectStation(page, 'Basel A');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Basel A');
  const draws = await canvas.evaluate((el) => Reflect.get(el, 'stationDraws') as number);
  await panel.getByRole('button', { name: '2 个电台', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect
    .poll(() => canvas.evaluate((el) => Reflect.get(el, 'stationDraws') as number))
    .toBeGreaterThan(draws);
  await expect.poll(positions).toEqual(before);
  expect(errors).toEqual([]);
});

test('places approximate province lights in Guangdong, Sichuan, Beijing, Shanghai and California', async ({
  page,
}, info) => {
  await page.setViewportSize(
    info.project.name === 'mobile-chromium'
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await install(page);
  await installPositionProbe(page, 6);
  const entries = [
    '广东省',
    'Guangdong',
    '四川省',
    '北京市',
    '上海市',
    'California',
    '广东省',
    '广东省',
  ].map((region, i) => ({
    ...testStation(100 + i),
    name: `Province station ${i}`,
    countryCode: i === 5 ? 'US' : 'CN',
    region,
    latitude: i === 6 ? 39.9 : i === 7 ? 23.13 : null,
    longitude: i === 6 ? 116.4 : i === 7 ? 113.26 : null,
    locationPrecision: i >= 6 ? ('coordinates' as const) : ('country' as const),
    streams: [{ ...testStation(100 + i).streams[0]!, url: 'https://media.haen.test/tone.mp3' }],
  }));
  const scene = testScene(entries);
  await page.route('**/api/v1/catalog**', (route) =>
    route.fulfill({
      json: route.request().url().includes('/chunks/') ? scene.chunk : scene.manifest,
    }),
  );
  await page.route(/\/api\/v1\/stations\/[0-9a-f-]{36}$/, (route) =>
    route.fulfill({ json: entries.find((s) => s.id === route.request().url().split('/').at(-1)) }),
  );
  await page.goto('./?station=' + entries[0]!.id);
  const panel = page.getByTestId('globe-panel');
  await expect(panel).toHaveAttribute('data-state', 'ready');
  await expect(panel.getByText('仅确定省/州；空心圆汇总电台，不表示具体台址。')).toBeVisible();
  const canvas = panel.locator('canvas');
  await expect
    .poll(() =>
      canvas.evaluate((el) => Reflect.get(el, 'stationPositions') as number[] | undefined),
    )
    .toHaveLength(18);
  const actual = await canvas.evaluate((el) => {
    const positions = Reflect.get(el, 'stationPositions') as number[];
    return Array.from({ length: 6 }, (_, i) => {
      const [x, y, z] = positions.slice(i * 3, i * 3 + 3) as [number, number, number];
      return {
        lat: (Math.asin(y / Math.hypot(x, y, z)) * 180) / Math.PI,
        lon: (Math.atan2(x, z) * 180) / Math.PI,
      };
    });
  });
  for (const [left, bottom, right, top, count] of [
    [109, 20, 118, 26, 2],
    [97, 26, 109, 34.5, 1],
    [115, 39, 118, 41.5, 1],
    [120, 30.5, 123, 32, 1],
    [-125, 32, -114, 42.5, 1],
  ])
    expect(
      actual.filter((p) => p.lon >= left! && p.lon <= right! && p.lat >= bottom! && p.lat <= top!),
    ).toHaveLength(count!);
  expect(
    actual.filter((p) => Math.abs(p.lat - 39.9) < 0.00001 && Math.abs(p.lon - 116.4) < 0.00001),
  ).toHaveLength(0);
  expect(
    actual.filter((p) => Math.abs(p.lat - 23.13) < 0.00001 && Math.abs(p.lon - 113.26) < 0.00001),
  ).toHaveLength(1);
  await page.screenshot({ path: info.outputPath('province-station-lights.png') });
  await panel.getByRole('button', { name: '广东省 · 省/州级大致位置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '广东省 · 省/州级大致位置' });
  await expect(dialog.getByText('3 个电台', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '同省/州下一站', exact: true })).toBeVisible();
});

test('checks GPU marker coordinates for all countries and provinces', async ({ page }, info) => {
  test.setTimeout(60000);
  await page.setViewportSize(
    info.project.name === 'mobile-chromium'
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installPositionProbe(page, 4834);
  await page.route('**/geographic-harness', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body style="margin:0;background:#081310"><div id="host" style="width:100vw;height:100vh"></div></body></html>',
    }),
  );
  await page.goto('/geographic-harness');
  const result = await page.evaluate(async () => {
    const globeUrl = '/src/graphics/globe.ts',
      modelUrl = '/src/graphics/model.ts',
      markerUrl = '/src/graphics/markers.ts',
      landUrl = '/src/graphics/land.ts',
      fixtureUrl = '/src/testing/stations.ts',
      regionUrl = '/src/graphics/regions.ts',
      countryUrl = '/src/graphics/countries.json';
    const [globe, model, markers, landModule, fixture, regions, countries] = await Promise.all([
      import(globeUrl) as Promise<typeof import('../../src/graphics/globe.js')>,
      import(modelUrl) as Promise<typeof import('../../src/graphics/model.js')>,
      import(markerUrl) as Promise<typeof import('../../src/graphics/markers.js')>,
      import(landUrl) as Promise<typeof import('../../src/graphics/land.js')>,
      import(fixtureUrl) as Promise<typeof import('../../src/testing/stations.js')>,
      import(regionUrl) as Promise<typeof import('../../src/graphics/regions.js')>,
      import(countryUrl) as Promise<{ default: Record<string, number[]> }>,
    ]);
    const land = await landModule.loadLand(new AbortController().signal);
    // Direct harness imports can have a different Vite module URL after HMR.
    await regions.loadRegions(new AbortController().signal);
    const data = (await fetch('/geography/regions.json').then((r) => r.json())) as Record<
      string,
      [string, string[], number[], number[]][]
    >;
    let nextId = 1;
    const stations = Object.keys(countries.default).map((countryCode) => ({
      ...fixture.testStation(nextId++),
      countryCode,
    }));
    for (const [countryCode, entries] of Object.entries(data))
      for (const [id, aliases] of entries) {
        const alias = aliases.find((value) => regions.stationRegion(countryCode, value)?.id === id);
        if (!alias) throw new Error('Ambiguous region ' + id);
        stations.push({ ...fixture.testStation(nextId++), countryCode, region: alias });
      }
    const groups = model.groupStations(stations),
      expected = markers.stationMarkers(groups);
    const host = document.getElementById('host')!;
    const engine = globe.createGlobe(host, land, {
      label: 'Geographic verification',
      pick() {},
      preview() {},
      lost() {},
      restored() {},
    });
    engine.setData(groups);
    Reflect.set(window, 'geographyVerification', { engine, expected });
    return {
      countries: Object.keys(countries.default).length,
      regions: stations.length - Object.keys(countries.default).length,
      count: expected.length,
    };
  });
  expect(result).toEqual({ countries: 250, regions: 4584, count: 4834 });
  const canvas = page.locator('canvas');
  await expect
    .poll(() =>
      canvas.evaluate(
        (el) => (Reflect.get(el, 'stationPositions') as number[] | undefined)?.length,
      ),
    )
    .toBe(4834 * 3);
  const verified = await page.evaluate(() => {
    const { expected, engine } = Reflect.get(window, 'geographyVerification') as {
      expected: import('../../src/graphics/markers.js').StationMarker[];
      engine: import('../../src/graphics/globe.js').GlobeController;
    };
    const raw = Reflect.get(document.querySelector('canvas')!, 'stationPositions') as number[];
    let largestError = 0;
    for (const [i, marker] of expected.entries()) {
      const [x, y, z] = raw.slice(i * 3, i * 3 + 3) as [number, number, number];
      const lat = (Math.asin(y / Math.hypot(x, y, z)) * 180) / Math.PI,
        lon = (Math.atan2(x, z) * 180) / Math.PI;
      const deltaLon = Math.abs(((lon - marker.longitude + 540) % 360) - 180);
      largestError = Math.max(largestError, Math.abs(lat - marker.latitude), deltaLon);
    }
    engine.destroy();
    return {
      checked: expected.length,
      largestError,
      remainingCanvases: document.querySelectorAll('canvas').length,
    };
  });
  expect(verified.checked).toBe(4834);
  expect(verified.largestError).toBeLessThan(0.00002);
  expect(verified.remainingCanvases).toBe(0);
});
