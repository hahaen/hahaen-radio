import { expect, test } from '@playwright/test';
import { first, second, openDirectory, listenButton, selectStation } from './listening-fixture.js';
import { installScale } from './scale-fixture.js';

test('loads 30000 entries, reuses cached chunks and keeps resources bounded across 60 station switches', async ({
  page,
  browserName,
}, info) => {
  test.setTimeout(300000);
  const counts = await installScale(page),
    errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const start = Date.now();
  await page.goto('/');
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await expect(page.getByText('地图可浏览 30,000 / 30,000 台', { exact: true })).toBeAttached({
    timeout: 30000,
  });
  const loadMs = Date.now() - start;
  const panel = page.getByTestId('globe-panel');
  await expect(panel).toHaveAttribute('data-state', 'ready', { timeout: 15000 });
  expect(counts.chunks).toBe(30);
  // A complete index must not fan out one detail request per station.
  expect(counts.details).toBe(0);
  const searchStart = Date.now();
  await openDirectory(page);
  const search = page.getByRole('searchbox', { name: '搜索电台', exact: true });
  await search.fill('Test radio 29999');
  await search.press('Enter');
  await expect(listenButton(page, 'Test radio 29999')).toBeVisible();
  const searchMs = Date.now() - searchStart;
  await search.fill('');
  await search.press('Enter');
  await expect(listenButton(page, first.name)).toBeVisible();
  const filterStart = Date.now();
  await page.locator('#station-directory').getByText('筛选电台', { exact: true }).click();
  await page.getByRole('checkbox', { name: '流行', exact: true }).check();
  await expect(page.getByText('地图可浏览 15,000 / 15,000 台', { exact: true })).toBeAttached();
  const filterMs = Date.now() - filterStart;
  await page.getByRole('button', { name: '清除全部条件', exact: true }).click();
  await expect(page.getByText('地图可浏览 30,000 / 30,000 台', { exact: true })).toBeAttached();
  await page.locator('#station-directory').getByText('筛选电台', { exact: true }).click();
  await selectStation(page, first.name);
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
      await selectStation(page, station.name);
      await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(station.name);
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
    await expect(page.getByText('地图可浏览 30,000 / 30,000 台', { exact: true })).toBeAttached({
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
