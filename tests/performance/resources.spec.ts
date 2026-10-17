import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { LandData } from '../../apps/web/src/graphics/land.js';
import type { StationGroup } from '../../apps/web/src/graphics/model.js';
import { installScale } from '../e2e/scale-fixture.js';
import { glReport, installGLProbe } from './webgl-probe.js';

test('stops production idle draws and releases native resources across engine rebuilds', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000);
  await installGLProbe(page);
  await installScale(page);
  await page.goto('/');
  await page.getByRole('button', { name: '中文', exact: true }).click();
  const panel = page.getByTestId('globe-panel');
  await expect(panel).toHaveAttribute('data-state', 'ready');
  await expect(page.getByText('30,000 / 30,000 个候选电台有坐标', { exact: true })).toBeVisible();
  await page.waitForTimeout(1000);
  const idle = await glReport(page);
  expect(idle).toHaveLength(1);
  expect(idle[0]!.draws).toBeGreaterThan(0);
  const dimensions = await panel.locator('canvas').evaluate((canvas) => {
    const rect = canvas.getBoundingClientRect();
    return { width: rect.width, height: rect.height, cap: rect.width < 768 ? 1.5 : 1.75 };
  });
  expect(idle[0]!.width).toBeLessThanOrEqual(Math.ceil(dimensions.width * dimensions.cap) + 1);
  expect(idle[0]!.height).toBeLessThanOrEqual(Math.ceil(dimensions.height * dimensions.cap) + 1);
  await page.waitForTimeout(1500);
  expect((await glReport(page))[0]!.draws).toBe(idle[0]!.draws);
  await page.getByRole('button', { name: '流派', exact: true }).click();
  const inactive = await glReport(page);
  await page.waitForTimeout(1500);
  expect((await glReport(page))[0]!.draws).toBe(inactive[0]!.draws);
  await page.getByRole('button', { name: '地球', exact: true }).click();
  await expect
    .poll(async () => (await glReport(page))[0]!.draws)
    .toBeGreaterThan(inactive[0]!.draws);
  const production = { idle, inactive, dimensions, resumed: await glReport(page) };

  // The isolated development-module harness exercises the actual controller's destroy API.
  // Its native-handle evidence is separate from the production UI measurements above.
  await page.route('http://127.0.0.1:5173/resource-harness', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body style="margin:0"><div id="host" style="width:360px;height:360px"></div></body></html>',
    }),
  );
  await page.goto('http://127.0.0.1:5173/resource-harness');
  const cycles = await page.evaluate(async () => {
    const globeUrl = '/src/graphics/globe.ts',
      modelUrl = '/src/graphics/model.ts';
    const fixtureUrl = '/src/testing/stations.ts',
      landUrl = '/src/graphics/land.ts';
    const globe = (await import(globeUrl)) as {
      createGlobe(
        host: HTMLElement,
        land: LandData,
        callbacks: Record<'pick' | 'preview' | 'lost' | 'restored', () => void>,
      ): { setData(groups: StationGroup[]): void; destroy(): void };
    };
    const model = (await import(modelUrl)) as typeof import('../../apps/web/src/graphics/model.js');
    const fixtures = (await import(
      fixtureUrl
    )) as typeof import('../../apps/web/src/testing/stations.js');
    const landModule = (await import(
      landUrl
    )) as typeof import('../../apps/web/src/graphics/land.js');
    const land = await landModule.loadLand(new AbortController().signal);
    const groups = model.groupStations(
      Array.from({ length: 30000 }, (_, index) => ({
        ...fixtures.testStation(index + 1),
        latitude: -75 + Math.floor(index / 300) * 1.5,
        longitude: -180 + (index % 300) * 1.2,
        locationPrecision: 'coordinates' as const,
      })),
    );
    const host = document.getElementById('host')!;
    const rendered = async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    };
    const samples = [];
    for (let cycle = 0; cycle < 12; cycle++) {
      const engine = globe.createGlobe(host, land, {
        pick() {},
        preview() {},
        lost() {},
        restored() {},
      });
      for (let update = 0; update < 6; update++) {
        engine.setData(update % 2 ? groups.slice(0, 15000) : groups);
        await rendered();
      }
      const before = window.__haenGLReport().at(-1)!;
      const lost = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Context loss not observed after destroy')),
          3000,
        );
        host.querySelector('canvas')!.addEventListener(
          'webglcontextlost',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
      engine.destroy();
      const afterDispose = window.__haenGLReport().at(-1)!;
      engine.destroy();
      await lost;
      await rendered();
      samples.push({
        cycle: cycle + 1,
        before,
        afterDispose,
        after: window.__haenGLReport().at(-1)!,
        canvases: host.querySelectorAll('canvas').length,
      });
    }
    return samples;
  });
  const path = info.outputPath('native-resources.json');
  await writeFile(
    path,
    JSON.stringify(
      {
        browser: browser.browserType().name(),
        version: browser.version(),
        viewport: page.viewportSize(),
        production,
        cycles,
      },
      null,
      2,
    ),
  );
  await info.attach('native-resources.json', { path, contentType: 'application/json' });
  expect(cycles).toHaveLength(12);
  for (const sample of cycles) {
    expect(sample.canvases).toBe(0);
    expect(sample.before.draws).toBeGreaterThan(0);
    expect(sample.before.resources.Buffer!.deleted).toBeGreaterThanOrEqual(10);
    for (const [kind, counts] of Object.entries(sample.before.resources))
      expect(counts.live, kind).toBe(cycles[0]!.before.resources[kind]!.live);
    // Renderer-owned fallback textures and scratch framebuffers are invalidated by context loss.
    // Application geometry/program/VAO resources must already have explicit deletion evidence.
    for (const kind of ['Buffer', 'Program', 'Shader', 'VertexArray'])
      expect(sample.afterDispose.resources[kind]!.live, kind).toBe(0);
    expect(sample.after.lost).toBe(true);
    for (const [kind, counts] of Object.entries(sample.after.resources)) {
      expect(counts.live, kind).toBe(0);
      expect(counts.created, kind).toBe(counts.deleted + counts.invalidated);
    }
  }
});
