import { continuousFixture, selectStation } from './listening-fixture.js';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { testStation, testScene } from '../../src/testing/stations.js';
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
  scene = false,
) {
  await continuousFixture(page);
  await page.addInitScript(() => sessionStorage.setItem('haen:exploring:v1', 'true'));
  const requests: string[] = [];
  await page.route('**/api/v1/catalog/scene**', async (route) => {
    requests.push(route.request().url().endsWith('/scene') ? 'scene-manifest' : 'scene-chunk');
    const data = testScene(stations);
    await route
      .fulfill(
        scene
          ? { json: route.request().url().endsWith('/scene') ? data.manifest : data.chunk }
          : {
              status: 503,
              json: {
                code: 'SERVICE_UNAVAILABLE',
                message: 'Scene intentionally disabled for list fallback fixture',
                requestId: 'fixture',
              },
            },
      )
      .catch(() => {});
  });
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
    await selectStation(page, station.name);
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
test('keeps decoded audio playing beyond the watchdog after a hidden-page network stall signal', async ({
  page,
}) => {
  await install(page, [fixture(1, 'mp3')]);
  await selectStation(page, '测试音源 MP3');
  await expectPlaying(page);
  const audio = page.locator('audio');
  const position = await audio.evaluate((element) => {
    const media = element as HTMLAudioElement;
    media.playbackRate = 0.5;
    // Start well before this looping fixture wraps its playback position.
    media.currentTime = 0;
    return media.currentTime;
  });
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    // The lifecycle/network signals are controlled; decoding and time advancement remain native.
    document.querySelector('audio')!.dispatchEvent(new Event('stalled'));
  });
  await page.waitForTimeout(8200);
  await expectPlaying(page);
  expect(
    await audio.evaluate((element) => (element as HTMLAudioElement).currentTime),
  ).toBeGreaterThan(position + 3);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'paused');
  expect(await audio.evaluate((element) => (element as HTMLAudioElement).paused)).toBe(true);
});
test('switches to a working backup after an invalid stream', async ({ page }) => {
  const station = fixture(1, 'mp3');
  station.streams.unshift({
    ...station.streams[0]!,
    id: '999999999999999999999999',
    url: origin + 'unavailable.mp3',
  });
  const requests = await install(page, [station]);
  await selectStation(page, station.name);
  await expectPlaying(page);
  expect(requests).toContain('unavailable.mp3');
  expect(requests).toContain('tone.mp3');
  await expect(page.getByText('线路 2/2', { exact: true })).toBeVisible();
});
test('does not restore a late station response after a rapid selection', async ({ page }) => {
  const first = fixture(1, 'mp3'),
    second = fixture(2, 'aac');
  await install(page, [first, second], first.id);
  await selectStation(page, first.name);
  await selectStation(page, second.name);
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
  await selectStation(page, station.name);
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
  await selectStation(page, first.name);
  await expectPlaying(page);
  await selectStation(page, second.name);
  await expectPlaying(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(second.name);
  expect(
    await page.locator('audio').evaluate((element) => (element as HTMLAudioElement).currentSrc),
  ).toContain('tone.aac');
});

test('keeps actual audio playing while using genre filters on the globe', async ({ page }) => {
  const station = {
    ...fixture(1, 'mp3'),
    latitude: 25,
    longitude: 80,
    locationPrecision: 'coordinates' as const,
  };
  await install(page, [station], undefined, undefined, true);
  await selectStation(page, station.name);
  await expectPlaying(page);
  const genres = page.getByRole('navigation', { name: '流派', exact: true });
  await genres.getByRole('button', { name: /^爵士/ }).click();
  await expectPlaying(page);
  await genres.getByRole('button', { name: /^全部流派/ }).click();
  await expectPlaying(page);
});
test('reuses the complete scene index from IndexedDB after reload', async ({ page }) => {
  const station = {
    ...fixture(1, 'mp3'),
    latitude: 25,
    longitude: 80,
    locationPrecision: 'coordinates' as const,
  };
  const requests = await install(page, [station], undefined, undefined, true);
  await expect(page.getByText('地图可浏览 1 / 1 台', { exact: true })).toBeAttached();
  const chunks = requests.filter((value) => value === 'scene-chunk').length;
  expect(chunks).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByText('地图可浏览 1 / 1 台', { exact: true })).toBeAttached();
  expect(requests.filter((value) => value === 'scene-chunk')).toHaveLength(chunks);
});
test('retains list playback when WebGL initialization is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value: function (this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
        return kind.startsWith('webgl') ? null : Reflect.apply(original, this, [kind, ...args]);
      },
    });
  });
  const station = fixture(1, 'mp3');
  await install(page, [station], undefined, undefined, true);
  await expect(
    page.getByText('此设备暂时无法显示地球，仍可通过列表收听。', { exact: true }),
  ).toBeVisible();
  await selectStation(page, station.name);
  await expectPlaying(page);
});
test('pins automatic selection and preserves paused intent after a globe dwell', async ({
  page,
}) => {
  const first = {
    ...fixture(1, 'mp3'),
    name: '测试音源 初始位置',
    countryCode: null,
    latitude: 25,
    longitude: 80,
    locationPrecision: 'coordinates' as const,
  };
  const second = {
    ...fixture(2, 'aac'),
    name: '测试音源 稳定位置',
    countryCode: null,
    latitude: 25,
    longitude: 60,
    locationPrecision: 'coordinates' as const,
  };
  await page.route('**/api/v1/account/session', (route) => route.fulfill({ json: { user: null } }));
  await install(page, [first, second], undefined, undefined, true);
  const panel = page.getByTestId('globe-panel');
  await expect(panel).toHaveAttribute('data-state', /ready|unavailable/, { timeout: 15000 });
  const supported = await page.evaluate(() => {
    const probe = document.createElement('canvas'),
      gl = probe.getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  });
  test.skip(
    !supported,
    'The browser has no native WebGL 2 context; list fallback is tested separately.',
  );
  await expect(panel).toHaveAttribute('data-state', 'ready');
  await selectStation(page, first.name);
  await expectPlaying(page);
  const canvas = panel.locator('canvas');
  const focus = async () => {
    await canvas.scrollIntoViewIfNeeded();
    await canvas.press('Home');
    await page.waitForTimeout(700);
  };
  const drag = async () => {
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    const b = bounds!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + b.height / 18, b.y + b.height / 2, { steps: 8 });
    await page.mouse.up();
  };
  await page.getByRole('button', { name: '固定当前电台', exact: true }).click();
  await focus();
  await drag();
  await page.waitForTimeout(2500);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(first.name);
  await page.getByRole('button', { name: '取消固定', exact: true }).click();
  await focus();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await drag();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(second.name, { timeout: 7000 });
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'paused');
  await expect(page.locator('audio')).toHaveCount(0);
});

test('restores a lost globe context without restarting current audio', async ({ page }) => {
  const station = {
    ...fixture(1, 'mp3'),
    latitude: 25,
    longitude: 80,
    locationPrecision: 'coordinates' as const,
  };
  await install(page, [station], undefined, undefined, true);
  const panel = page.getByTestId('globe-panel');
  await expect(panel).toHaveAttribute('data-state', /ready|unavailable/, { timeout: 15000 });
  const supported = await page.evaluate(() => {
    const probe = document.createElement('canvas'),
      gl = probe.getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  });
  test.skip(
    !supported,
    'The browser has no native WebGL 2 context; list fallback is tested separately.',
  );
  await expect(panel).toHaveAttribute('data-state', 'ready');
  await selectStation(page, station.name);
  await expectPlaying(page);
  const lost = await panel.locator('canvas').evaluate((canvas) => {
    const gl = (canvas as HTMLCanvasElement).getContext('webgl2'),
      extension = gl?.getExtension('WEBGL_lose_context');
    if (!extension) return false;
    Reflect.set(canvas, Symbol.for('haen:test:context-loss'), extension);
    extension.loseContext();
    return true;
  });
  test.skip(!lost, 'The native context does not expose the optional loss simulation extension.');
  await expect(panel).toHaveAttribute('data-state', 'lost');
  await panel.locator('canvas').evaluate((canvas) => canvas.focus());
  await expect(panel.locator('canvas')).not.toBeFocused();
  await expectPlaying(page);
  await panel.locator('canvas').evaluate((canvas) => {
    const extension = Reflect.get(canvas, Symbol.for('haen:test:context-loss')) as
      WEBGL_lose_context | undefined;
    extension?.restoreContext();
    Reflect.deleteProperty(canvas, Symbol.for('haen:test:context-loss'));
  });
  await expect(panel).toHaveAttribute('data-state', 'ready', { timeout: 10000 });
  await panel.locator('canvas').focus();
  await expect(panel.locator('canvas')).toBeFocused();
  await expectPlaying(page);
  await expect(panel.locator('canvas')).toHaveCount(1);
});

test('expands a known-city cluster and cycles its actual stations', async ({ page }) => {
  const first = {
    ...fixture(1, 'mp3'),
    name: '测试同城 甲',
    city: '测试城市',
    latitude: 25,
    longitude: 80,
    locationPrecision: 'coordinates' as const,
  };
  const second = {
    ...fixture(2, 'aac'),
    name: '测试同城 乙',
    city: '测试城市',
    latitude: 25.001,
    longitude: 80.001,
    locationPrecision: 'coordinates' as const,
  };
  await install(page, [first, second], undefined, undefined, true);
  const panel = page.getByTestId('globe-panel');
  await expect(panel).toHaveAttribute('data-state', /ready|unavailable/, { timeout: 15000 });
  const supported = await page.evaluate(() => {
    const probe = document.createElement('canvas'),
      gl = probe.getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  });
  test.skip(!supported, 'No native WebGL 2 context. List fallback is tested separately.');
  await expect(panel).toHaveAttribute('data-state', 'ready');
  await selectStation(page, first.name);
  await expectPlaying(page);
  const canvas = panel.locator('canvas');
  await canvas.scrollIntoViewIfNeeded();
  await canvas.press('Home');
  await page.waitForTimeout(700);
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  await canvas.click({ position: { x: bounds!.width / 2, y: bounds!.height / 2 } });
  const list = page.getByRole('dialog', { name: '测试城市', exact: true });
  await expect(list).toBeVisible();
  await list.getByRole('button', { name: '同城下一站', exact: true }).click();
  await expect(page.locator('h1')).toHaveText(second.name);
  await expect(page.locator('[role="status"]')).toHaveAttribute('data-state', 'playing');
  await list.getByRole('button', { name: '关闭面板', exact: true }).click();
  await expect(list).toHaveCount(0);
  await expect(canvas).toBeFocused();
});
test('rotates with a touch and zooms with a two-finger pinch on the mobile viewport', async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(
    browserName !== 'chromium' || !isMobile,
    'Trusted touch synthesis is specific to the mobile Chromium project.',
  );
  const station = {
    ...fixture(1, 'mp3'),
    latitude: 25,
    longitude: 80,
    locationPrecision: 'coordinates' as const,
  };
  await install(page, [station], undefined, undefined, true);
  const panel = page.getByTestId('globe-panel');
  await expect(panel).toHaveAttribute('data-state', 'ready', { timeout: 15000 });
  await selectStation(page, station.name);
  await expectPlaying(page);
  await page.getByRole('button', { name: '固定当前电台', exact: true }).click();
  const canvas = panel.locator('canvas');
  await canvas.scrollIntoViewIfNeeded();
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const b = bounds!,
    x = b.x + b.width / 2,
    y = b.y + b.height / 2;
  const session = await page.context().newCDPSession(page);
  const before = await canvas.screenshot();
  const scroll = await page.evaluate(() => scrollY);
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, id: 1 }],
  });
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: x + 40, y, id: 1 }],
  });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(700);
  const rotated = await canvas.screenshot();
  expect(rotated.equals(before)).toBe(false);
  expect(await page.evaluate(() => scrollY)).toBe(scroll);
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: x - 40, y, id: 1 },
      { x: x + 40, y, id: 2 },
    ],
  });
  for (let step = 1; step <= 6; step++)
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: x - 40 - step * 5, y, id: 1 },
        { x: x + 40 + step * 5, y, id: 2 },
      ],
    });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(700);
  expect((await canvas.screenshot()).equals(rotated)).toBe(false);
  await expectPlaying(page);
  await session.detach();
});
