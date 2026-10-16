import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { testStation } from '../../apps/web/src/testing/stations.js';
type StationDetail = ReturnType<typeof testStation>;

const origin = 'https://media.haen.test/';
function fixture(index: number, format: 'mp3' | 'aac' | 'm3u8'): StationDetail {
  const value = testStation(index);
  return {
    ...value,
    name: '测试音源 ' + format.toUpperCase(),
    streams: [
      {
        ...value.streams[0]!,
        url: origin + 'tone.' + format,
        hls: format === 'm3u8',
        codec: format === 'mp3' ? 'MP3' : 'AAC',
      },
    ],
  };
}
async function install(
  page: Page,
  stations: StationDetail[],
  delayedId?: string,
  delayedMedia?: string,
) {
  const requests: string[] = [];
  await page.route('**/api/v1/stations**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/stations') {
      const query = url.searchParams.get('q')?.toLowerCase() ?? '';
      const excluded = new Set((url.searchParams.get('excludeIds') ?? '').split(','));
      const matches = stations.filter(
        (station) => station.name.toLowerCase().includes(query) && !excluded.has(station.id),
      );
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const limit = Number(url.searchParams.get('limit') ?? 30);
      await route.fulfill({
        json: {
          items: matches.slice(offset, offset + limit),
          total: matches.length,
          offset,
          limit,
        },
      });
    } else {
      const id = url.pathname.split('/').at(-1);
      if (id === delayedId) await new Promise((resolve) => setTimeout(resolve, 800));
      const station = stations.find((value) => value.id === id);
      await route
        .fulfill(
          station
            ? { json: station }
            : {
                status: 404,
                json: {
                  code: 'NOT_FOUND',
                  message: 'Fixture not found',
                  requestId: 'fixture-request',
                },
              },
        )
        .catch(() => {});
    }
  });
  await page.route(origin + '**', async (route) => {
    const file = new URL(route.request().url()).pathname.slice(1);
    requests.push(file);
    if (file === delayedMedia) await new Promise((resolve) => setTimeout(resolve, 600));
    if (!/^(tone\.(mp3|aac|m3u8)|segment-\d{2}\.ts)$/.test(file)) {
      await route.fulfill({ status: 503, body: '' });
      return;
    }
    const body = await readFile(new URL('../fixtures/audio/' + file, import.meta.url));
    const extension = file.split('.').at(-1)!;
    const contentType = {
      mp3: 'audio/mpeg',
      aac: 'audio/aac',
      m3u8: 'application/vnd.apple.mpegurl',
      ts: 'video/mp2t',
    }[extension]!;
    const requestHeaders = route.request().headers();
    const range = requestHeaders['range']?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
    if (start >= body.length || end < start) {
      await route.fulfill({ status: 416, body: '' });
      return;
    }
    const payload = body.subarray(start, end + 1);
    await route.fulfill({
      status: range ? 206 : 200,
      contentType,
      body: payload,
      headers: {
        'access-control-allow-origin': '*',
        'accept-ranges': 'bytes',
        'content-length': String(payload.length),
        ...(range ? { 'content-range': 'bytes ' + start + '-' + end + '/' + body.length } : {}),
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await page.getByRole('slider', { name: '音量' }).press('Home');
  await page.getByRole('slider', { name: '音量' }).press('ArrowRight');
  return requests;
}
async function expectPlaying(page: Page) {
  const status = page.getByRole('status');
  await expect(status).toHaveAttribute('data-state', /playing|blocked/, { timeout: 12000 });
  if ((await status.getAttribute('data-state')) === 'blocked')
    await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(status).toHaveAttribute('data-state', 'playing');
  const audio = page.locator('audio');
  await expect(audio).toHaveCount(1);
  await expect
    .poll(() => audio.evaluate((element) => (element as HTMLAudioElement).currentTime))
    .toBeGreaterThan(0.25);
  expect(await audio.evaluate((element) => (element as HTMLAudioElement).error)).toBeNull();
}
for (const format of ['mp3', 'aac', 'm3u8'] as const) {
  test('decodes controlled ' + format + ' media and supports pause/resume', async ({ page }) => {
    const station = fixture(1, format);
    const requests = await install(page, [station]);
    await page.getByRole('button', { name: '收听 ' + station.name, exact: true }).click();
    await expectPlaying(page);
    expect(requests).toContain('tone.' + format);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await expect(page.getByRole('status')).toHaveAttribute('data-state', 'paused');
    expect(
      await page.locator('audio').evaluate((element) => (element as HTMLAudioElement).paused),
    ).toBe(true);
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await expectPlaying(page);
  });
}
test('switches to a working backup after an invalid stream', async ({ page }) => {
  const station = fixture(1, 'mp3');
  station.streams.unshift({
    ...station.streams[0]!,
    id: '999999999999999999999999',
    url: origin + 'unavailable.mp3',
  });
  const requests = await install(page, [station]);
  await page.getByRole('button', { name: '收听 ' + station.name, exact: true }).click();
  await expectPlaying(page);
  expect(requests).toContain('unavailable.mp3');
  expect(requests).toContain('tone.mp3');
  await expect(page.getByText('线路 2/2', { exact: true })).toBeVisible();
});
test('does not restore a late station response after a rapid selection', async ({ page }) => {
  const first = fixture(1, 'mp3'),
    second = fixture(2, 'aac');
  await install(page, [first, second], first.id);
  await page.getByRole('button', { name: '收听 ' + first.name, exact: true }).click();
  await page.getByRole('button', { name: '收听 ' + second.name, exact: true }).click();
  await expectPlaying(page);
  // The first response intentionally finishes after 800ms.
  await page.waitForTimeout(1000);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(second.name);
  await expect(page.locator('audio')).toHaveCount(1);
  expect(
    await page.locator('audio').evaluate((element) => (element as HTMLAudioElement).currentSrc),
  ).toContain('tone.aac');
});
test('can pause and resume while an HLS manifest is still loading', async ({ page }) => {
  const station = fixture(1, 'm3u8');
  await install(page, [station], undefined, 'tone.m3u8');
  const manifest = page.waitForRequest(origin + 'tone.m3u8');
  await page.getByRole('button', { name: '收听 ' + station.name, exact: true }).click();
  await manifest;
  await page.getByRole('button', { name: '固定当前电台', exact: true }).click();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'paused');
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expectPlaying(page);
});

test('continues explicit playback when switching from playing audio to a slow station detail', async ({
  page,
}) => {
  const first = fixture(1, 'mp3'),
    second = fixture(2, 'aac');
  await install(page, [first, second], second.id);
  await page.getByRole('button', { name: '收听 ' + first.name, exact: true }).click();
  await expectPlaying(page);
  await page.getByRole('button', { name: '收听 ' + second.name, exact: true }).click();
  await expectPlaying(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(second.name);
  expect(
    await page.locator('audio').evaluate((element) => (element as HTMLAudioElement).currentSrc),
  ).toContain('tone.aac');
});
