import { expect, test, type Page } from '@playwright/test';
import { encodeSceneEntry } from '../../packages/contracts/src/scene.js';
import { testScene, testStation } from '../../apps/web/src/testing/stations.js';
import { first, second, install } from './listening-fixture.js';

// Synthetic scale data is restricted to this test; the application has no fixture fallback.
const stations = Array.from({ length: 30000 }, (_, index) => ({
  ...(index === 0 ? first : index === 1 ? second : testStation(index + 1)),
  latitude: -75 + Math.floor(index / 300) * 1.5,
  longitude: -180 + (index % 300) * 1.2,
  locationPrecision: 'coordinates' as const,
  genre: index % 2 ? ('pop' as const) : ('jazz' as const),
  languages: [index % 2 ? 'fr' : 'en'],
  bitrate: index % 2 ? 320 : 128,
  streams: [{ ...testStation(index + 1).streams[0]!, url: 'https://media.haen.test/tone.mp3' }],
}));
const manifest = {
  ...testScene([]).manifest,
  stationCount: stations.length,
  playableCount: stations.length,
  countryCount: 1,
  genres: [
    { id: 'jazz', count: 15000 },
    { id: 'pop', count: 15000 },
  ],
  languages: [
    { id: 'en', count: 15000 },
    { id: 'fr', count: 15000 },
  ],
  chunks: Array.from({ length: 30 }, (_, index) => ({ index, count: 1000 })),
};
async function installScale(page: Page) {
  await install(page);
  const counts = { chunks: 0, details: 0, searches: 0, media: 0, other: 0 };
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname === 'media.haen.test') counts.media++;
    else if (/\/stations\/[a-f0-9-]{36}$/.test(url.pathname)) counts.details++;
    else if (url.pathname === '/api/v1/stations') counts.searches++;
    else if (url.pathname.startsWith('/api/')) counts.other++;
  });
  await page.route('**/api/v1/catalog**', (route) => {
    const url = new URL(route.request().url()),
      last = url.pathname.split('/').at(-1);
    if (last === 'scene' || url.pathname === '/api/v1/catalog')
      return route.fulfill({ json: manifest });
    const index = Number(last);
    if (!Number.isInteger(index) || index < 0 || index >= 30)
      return route.fulfill({ status: 404, body: '' });
    counts.chunks++;
    return route.fulfill({
      json: {
        format: 1,
        version: manifest.version,
        restrictionsRevision: manifest.restrictionsRevision,
        index,
        entries: stations.slice(index * 1000, (index + 1) * 1000).map(encodeSceneEntry),
      },
    });
  });
  await page.route('**/api/v1/stations**', (route) => {
    const url = new URL(route.request().url()),
      q = url.searchParams;
    if (url.pathname === '/api/v1/stations') {
      const matches = stations.filter(
        (station) =>
          station.name.toLowerCase().includes((q.get('q') ?? '').toLowerCase()) &&
          (!q.has('genres') || q.get('genres')!.split(',').includes(station.genre)) &&
          (!q.has('languages') ||
            station.languages.some((language) =>
              q.get('languages')!.split(',').includes(language),
            )) &&
          station.bitrate >= Number(q.get('minBitrate') ?? 0),
      );
      const offset = Number(q.get('offset') ?? 0),
        limit = Number(q.get('limit') ?? 30);
      return route.fulfill({
        json: {
          items: matches.slice(offset, offset + limit),
          total: matches.length,
          offset,
          limit,
        },
      });
    }
    if (url.pathname.endsWith('/lookup')) {
      const ids = route.request().postDataJSON().ids as string[];
      return route.fulfill({
        json: { items: stations.filter((station) => ids.includes(station.id)), missing: [] },
      });
    }
    const id = url.pathname.split('/').at(-1),
      station = stations.find((item) => item.id === id);
    return route.fulfill(
      station
        ? { json: station }
        : {
            status: 404,
            json: { code: 'NOT_FOUND', message: 'Controlled scale fixture', requestId: 'scale' },
          },
    );
  });
  return counts;
}

test('loads 30000 entries, reuses cached chunks and keeps resources bounded across 60 station and view switches', async ({
  page,
  browserName,
}, info) => {
  test.setTimeout(180000);
  const counts = await installScale(page),
    errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const start = Date.now();
  await page.goto('/');
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await expect(page.getByText('30,000 / 30,000 个候选电台有坐标', { exact: true })).toBeVisible({
    timeout: 30000,
  });
  const loadMs = Date.now() - start;
  const panel = page.getByTestId('globe-panel');
  await expect(panel).toHaveAttribute('data-state', 'ready', { timeout: 15000 });
  expect(counts.chunks).toBe(30);
  // A complete index must not fan out one detail request per station.
  expect(counts.details).toBe(0);
  const searchStart = Date.now();
  const search = page.getByRole('searchbox', { name: '搜索电台', exact: true });
  await search.fill('Test radio 29999');
  await search.press('Enter');
  await expect(
    page.getByRole('button', { name: '收听 Test radio 29999', exact: true }),
  ).toBeVisible();
  const searchMs = Date.now() - searchStart;
  await search.fill('');
  await search.press('Enter');
  await expect(page.getByRole('button', { name: '收听 ' + first.name, exact: true })).toBeVisible();
  const filterStart = Date.now();
  await page.getByText('筛选电台', { exact: true }).click();
  await page.getByRole('checkbox', { name: '流行', exact: true }).check();
  await expect(page.getByText('15,000 / 15,000 个候选电台有坐标', { exact: true })).toBeVisible();
  const filterMs = Date.now() - filterStart;
  await page.getByRole('button', { name: '清除全部条件', exact: true }).click();
  await expect(page.getByText('30,000 / 30,000 个候选电台有坐标', { exact: true })).toBeVisible();
  await page.getByText('筛选电台', { exact: true }).click();
  await page.getByRole('button', { name: '收听 ' + first.name, exact: true }).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
  await page.getByRole('button', { name: '固定当前电台', exact: true }).click();
  await page.getByRole('slider', { name: '音量', exact: true }).press('Home');
  const session = browserName === 'chromium' ? await page.context().newCDPSession(page) : null;
  if (session) await session.send('Performance.enable');
  const samples: {
    switches: number;
    heap: number | null;
    nodes: number;
    listeners: number | null;
    media: number;
    details: number;
  }[] = [];
  try {
    for (let index = 0; index < 60; index++) {
      const station = index % 2 ? second : first;
      await page.getByRole('button', { name: '收听 ' + station.name, exact: true }).click();
      await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(station.name);
      await page.getByRole('button', { name: '流派', exact: true }).click();
      await expect(page.getByRole('button', { name: /爵士.*15,000 台/ })).toBeVisible();
      await page.getByRole('button', { name: '地球', exact: true }).click();
      await expect(page.locator('audio')).toHaveCount(1);
      await expect(panel.locator('canvas')).toHaveCount(1);
      if ([9, 29, 59].includes(index)) {
        await expect
          .poll(() =>
            page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime),
          )
          .toBeGreaterThan(0.1);
        if (session) await session.send('HeapProfiler.collectGarbage');
        const metrics = session ? (await session.send('Performance.getMetrics')).metrics : [];
        const metric = (name: string) =>
          metrics.find((value) => value.name === name)?.value ?? null;
        samples.push({
          switches: index + 1,
          heap: metric('JSHeapUsedSize'),
          nodes: metric('Nodes') ?? (await page.locator('*').count()),
          listeners: metric('JSEventListeners'),
          media: counts.media,
          details: counts.details,
        });
      }
    }
    const base = samples[0]!,
      last = samples.at(-1)!;
    if (base.heap !== null && last.heap !== null)
      expect(last.heap - base.heap).toBeLessThan(10 * 1024 * 1024);
    expect(last.nodes - base.nodes).toBeLessThan(200);
    if (base.listeners !== null && last.listeners !== null)
      expect(last.listeners - base.listeners).toBeLessThan(100);
    // WebKit probes bytes 0-1 before requesting the body: two ranges per play.
    expect(counts.media).toBeLessThanOrEqual(2 * 61);
    expect(counts.details).toBeLessThanOrEqual(61);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await expect(page.getByRole('status')).toHaveAttribute('data-state', 'paused');
    const pausedMedia = counts.media;
    await page.waitForTimeout(1200);
    expect(counts.media).toBe(pausedMedia);
    await page.reload();
    await expect(page.getByText('30,000 / 30,000 个候选电台有坐标', { exact: true })).toBeVisible({
      timeout: 30000,
    });
    expect(counts.chunks).toBe(30);
    expect(errors).toEqual([]);
    await info.attach('scale-and-stability.json', {
      body: JSON.stringify(
        { syntheticEntries: 30000, loadMs, searchMs, filterMs, samples, counts, errors },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  } finally {
    await session?.detach();
  }
});
