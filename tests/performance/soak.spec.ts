import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { first, second, listenButton } from '../e2e/listening-fixture.js';
import { installScale } from '../e2e/scale-fixture.js';
import { glReport, installGLProbe, type GLContextReport } from './webgl-probe.js';

const seconds = Number(process.env.HAEN_SOAK_SECONDS ?? 600);
if (!Number.isInteger(seconds) || seconds < 60 || seconds > 3600)
  throw new Error('HAEN_SOAK_SECONDS must be an integer from 60 to 3600');

test('sustains production playback and exploration with bounded resources', async ({
  page,
  browser,
}, info) => {
  test.setTimeout((seconds + 120) * 1000);
  await installGLProbe(page);
  const counts = await installScale(page),
    errors: string[] = [],
    unexpectedRequests: string[] = [];
  let metadata = 0,
    catalogPolls = 0;
  await page.route('**/api/v1/stations/*/now-playing?*', (route) => {
    const url = new URL(route.request().url());
    metadata++;
    return route.fulfill({
      json: {
        stationId: url.pathname.split('/').at(-2),
        streamId: url.searchParams.get('streamId'),
        source: 'station-icy',
        status: 'unavailable',
        rawTitle: null,
        song: null,
        observedAt: new Date().toISOString(),
        timing: 'unknown',
        retryAfter: 60,
      },
    });
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/catalog/scene' || url.pathname === '/api/v1/catalog')
      catalogPolls++;
    if (!['127.0.0.1', 'media.haen.test'].includes(url.hostname))
      unexpectedRequests.push(url.origin);
  });
  await page.goto('/');
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await expect(page.getByText('30,000 / 30,000 个候选电台有坐标', { exact: true })).toBeVisible();
  const panel = page.getByTestId('globe-panel');
  await expect(panel).toHaveAttribute('data-state', 'ready');
  await listenButton(page, first.name).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
  await page.getByRole('button', { name: '固定当前电台', exact: true }).click();
  await page.getByRole('slider', { name: '音量', exact: true }).press('Home');
  const session = await page.context().newCDPSession(page);
  await session.send('Performance.enable');
  const start = performance.now();
  let switches = 0;
  const samples: {
    elapsedMs: number;
    switches: number;
    heap: number;
    nodes: number;
    listeners: number;
    gl: GLContextReport[];
    media: number;
    details: number;
    metadata: number;
  }[] = [];
  const sample = async () => {
    await session.send('HeapProfiler.collectGarbage');
    const metrics = (await session.send('Performance.getMetrics')).metrics;
    const metric = (name: string) => {
      const value = metrics.find((item) => item.name === name)?.value;
      if (value === undefined) throw new Error('Required CDP metric unavailable: ' + name);
      return value;
    };
    console.log(
      info.project.name +
        ' resource sample ' +
        JSON.stringify({
          elapsedSeconds: Math.round((performance.now() - start) / 1000),
          switches,
          heap: metric('JSHeapUsedSize'),
          nodes: metric('Nodes'),
        }),
    );
    samples.push({
      elapsedMs: performance.now() - start,
      switches,
      heap: metric('JSHeapUsedSize'),
      nodes: metric('Nodes'),
      listeners: metric('JSEventListeners'),
      gl: await glReport(page),
      media: counts.media,
      details: counts.details,
      metadata,
    });
  };
  try {
    do {
      await listenButton(page, switches % 2 ? first.name : second.name).click();
      switches++;
      await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
      if (switches % 6 === 0) {
        await page.getByText('筛选电台', { exact: true }).click();
        await page.getByRole('checkbox', { name: '流行', exact: true }).check();
        await expect(
          page.getByText('15,000 / 15,000 个候选电台有坐标', { exact: true }),
        ).toBeVisible();
        await page.getByRole('button', { name: '清除全部条件', exact: true }).click();
        await page.getByText('筛选电台', { exact: true }).click();
        await page.getByRole('button', { name: '流派', exact: true }).click();
        await page.getByRole('button', { name: '地球', exact: true }).click();
      }
      await expect(page.locator('audio')).toHaveCount(1);
      await expect(panel.locator('canvas')).toHaveCount(1);
      await expect
        .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime))
        .toBeGreaterThan(0.1);
      await page.waitForTimeout(4000);
      if (
        switches === 6 ||
        (samples.length && performance.now() - start - samples.at(-1)!.elapsedMs >= 30000)
      )
        await sample();
    } while (performance.now() - start < seconds * 1000);
    await sample();
    const base = samples[0]!,
      last = samples.at(-1)!;
    expect(last.elapsedMs).toBeGreaterThanOrEqual(seconds * 1000);
    expect(samples.length).toBeGreaterThanOrEqual(2);
    for (const current of samples) {
      expect(current.heap - base.heap).toBeLessThan(10 * 1024 * 1024);
      expect(current.nodes - base.nodes).toBeLessThan(200);
      expect(current.listeners - base.listeners).toBeLessThan(100);
      expect(current.gl).toHaveLength(1);
      expect(current.gl[0]!.lost).toBe(false);
      for (const [kind, value] of Object.entries(current.gl[0]!.resources))
        expect(value.live, kind).toBe(base.gl[0]!.resources[kind]!.live);
    }
    expect(counts.chunks).toBe(30);
    expect(counts.searches).toBeLessThanOrEqual(2);
    expect(catalogPolls).toBeLessThanOrEqual(Math.ceil(seconds / 300) + 1);
    expect(counts.other).toBeLessThanOrEqual(counts.chunks + metadata + catalogPolls + 1);
    expect(counts.details).toBeLessThanOrEqual(switches + 1);
    expect(counts.media).toBeLessThanOrEqual(2 * (switches + 1));
    expect(metadata).toBeLessThanOrEqual(switches + Math.ceil(seconds / 60) + 2);
    expect(errors).toEqual([]);
    expect(unexpectedRequests).toEqual([]);
  } finally {
    const path = info.outputPath('production-soak.json');
    await writeFile(
      path,
      JSON.stringify(
        {
          configuredSeconds: seconds,
          elapsedMs: performance.now() - start,
          switches,
          syntheticEntries: 30000,
          browser: browser.browserType().name(),
          version: browser.version(),
          viewport: page.viewportSize(),
          samples,
          counts,
          metadata,
          catalogPolls,
          errors,
          unexpectedRequests,
        },
        null,
        2,
      ),
    );
    await info.attach('production-soak.json', { path, contentType: 'application/json' });
    await session.detach();
  }
});
