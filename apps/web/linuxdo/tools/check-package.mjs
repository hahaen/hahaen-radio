import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { chromium, devices, expect, webkit } from '@playwright/test';
import { snapshotSchema, unpackSnapshot } from '../schemas.ts';

const archive = process.argv[2] ?? 'dist/check/app.zip';
assert.ok(statSync(archive).size <= 4096 * 1024, 'ZIP must fit the LINUX DO upload limit');
const files = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .sort();
const unpack = (name) =>
  execFileSync('unzip', ['-p', archive, name], { maxBuffer: 32 * 1024 * 1024 });
const manifest = JSON.parse(unpack('manifest.json'));
assert.deepEqual(
  files,
  ['manifest.json', 'index.html', 'app.js', 'app.css', 'strings.json', ...manifest.assets].sort(),
);
assert.equal(manifest.name, '声屿 HAEN');
assert.equal('links' in manifest, false);
assert.equal('remote_assets' in manifest, false);
assert.ok(manifest.assets.includes('data/catalog.json'));
assert.equal(
  files.some((file) => /\.(?:mp3|aac|wav|m4a|ogg|flac)$/i.test(file)),
  false,
);

const index = unpack('index.html').toString();
const script = unpack('app.js').toString();
const css = unpack('app.css').toString();
const sources = JSON.parse(unpack('data/streams.json'));
const [candidate] = sources;
assert.deepEqual(manifest.permissions, [
  'storage.read',
  'storage.write',
  ...(sources.length ? ['network.request', 'audio.webAudio'] : []),
]);
assert.deepEqual(
  Object.keys(manifest.endpoints ?? {}).sort(),
  sources.map(({ endpoint }) => endpoint).sort(),
);
for (const endpoint of Object.values(manifest.endpoints ?? {})) {
  const url = new URL(endpoint.url);
  assert.equal(url.protocol, 'https:');
  assert.doesNotMatch(url.hostname, /(^|\.)hahaen\.xyz\.?$/);
  assert.deepEqual(endpoint, { url: endpoint.url, method: 'GET', auth: 'none' });
}
const samplePath = process.env.HAEN_LINUXDO_AUDIO_SAMPLE;
const audioSample = samplePath ? readFileSync(samplePath).toString('base64') : '';
const decoded = unpackSnapshot(JSON.parse(unpack('data/catalog.json')));
assert.deepEqual(
  decoded,
  snapshotSchema.parse(JSON.parse(readFileSync('data/catalog.json', 'utf8'))),
);
const { stations, manifest: scene } = decoded;
const stationCount = stations.length;
assert.equal(stationCount, scene.stationCount);
const sourceIds = new Set(sources.map(({ stationId }) => stationId));
const nameKey = (name) => name.normalize('NFKC').trim().toLowerCase();
const cityKey = ([, , country, region, city, nearby]) =>
  country && (city ?? nearby)
    ? JSON.stringify([country, nameKey(region ?? ''), nameKey(city ?? nearby)])
    : null;
const cities = new Map();
const names = new Map();
for (const station of stations) {
  const name = nameKey(station[1]);
  names.set(name, (names.get(name) ?? 0) + 1);
  const city = cityKey(station);
  if (city) {
    if (!cities.has(city)) cities.set(city, []);
    cities.get(city).push(station);
  }
}
const first = stations.find((station) => {
  const group = cities.get(cityKey(station));
  return (
    station[9] === 'news' &&
    /^[A-Za-z0-9 .'-]+$/.test(station[1]) &&
    names.get(nameKey(station[1])) === 1 &&
    group?.length > 1 &&
    group.length < 10 &&
    group.every(([id]) => !sourceIds.has(id))
  );
});
assert.ok(first, 'Find a named news station with a small local city group in the snapshot');
const sameCity = cities.get(cityKey(first));
const legacy = sameCity.find(([id]) => id !== first[0]);
const playable = candidate && stations.find(([id]) => id === candidate.stationId);
if (candidate) assert.ok(playable, 'Sandbox source belongs to the packaged catalog');

const origin = 'https://linuxdo-check.invalid';
const resources = Object.fromEntries(
  manifest.assets.map((path) => [
    path,
    path.startsWith('data/') ? JSON.parse(unpack(path)) : unpack(path).toString('base64'),
  ]),
);
const createHarness = (sample) => `
  const resources = ${JSON.stringify(resources).replaceAll('<', '\\u003c')};
  const permissions = ${JSON.stringify(manifest.permissions)};
  const storage = { 'haen:ld:favorites:v1': ${JSON.stringify(JSON.stringify([legacy[0]]))} };
  let ready = false;
  window.assetReads = [];
  window.saved = storage;
  const sample = ${JSON.stringify(sample)};
  window.audioEvidence = { scheduled: 0, cancelled: 0 };
  window.endpointReads = [];
  const NativeAudioContext = window.AudioContext;
  window.AudioContext = window.webkitAudioContext = sample
    ? class extends NativeAudioContext {
        createBufferSource() {
          const source = super.createBufferSource();
          const start = source.start.bind(source);
          source.start = (...args) => {
            if (source.buffer.getChannelData(0).some((value) => Math.abs(value) > 0.001))
              window.audioEvidence.scheduled++;
            return start(...args);
          };
          return source;
        }
      }
    : class { constructor() { throw new Error('Audio is disabled during this check'); } };
  HTMLMediaElement.prototype.play = () => { throw new Error('Media is disabled during this check'); };
  window.fetch = () => { window.endpointReads.push('fetch'); throw new Error('Unexpected browser fetch'); };
  window.miniApp = {
    ready: Promise.resolve(),
    lifecycle: { ready: async () => { ready = true; } },
    assets: {
      readJson: async (path) => read(path),
      readBytes: async (path) => Uint8Array.from(atob(read(path)), (c) => c.charCodeAt(0)),
    },
    http: {
      request: async (endpoint) => {
        window.endpointReads.push(endpoint);
        throw new Error('Unexpected SDK HTTP request ' + endpoint);
      },
      stream: async (endpoint) => {
        if (!sample || endpoint !== ${JSON.stringify(candidate?.endpoint ?? null)}) throw new Error('Unexpected stream request');
        return { status: 200, headers: { 'content-type': 'audio/mpeg' }, body: new ReadableStream({
          start(controller) { controller.enqueue(Uint8Array.from(atob(sample), (c) => c.charCodeAt(0))); },
          cancel() { window.audioEvidence.cancelled++; },
        }) };
      },
    },
    permissions: { has: (key) => permissions.includes(key) },
    localStorage: {
      getItem: async (key) => storage[key] ?? null,
      setItem: async (key, value) => { storage[key] = value; },
    },
  };
  function read(path) {
    if (!ready || !Object.hasOwn(resources, path)) throw new Error('Unexpected asset read ' + path);
    window.assetReads.push(path);
    return resources[path];
  }
`;
const createPage = (sample) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style>${index}<script>${createHarness(sample)}</script><script>${script}</script>`;

for (const { engine, label, options } of [
  { engine: chromium, label: 'Chromium 桌面', options: { viewport: { width: 1280, height: 800 } } },
  { engine: webkit, label: 'WebKit 手机视口', options: devices['iPhone 13'] },
]) {
  const app = createPage(audioSample);
  const browser = await engine.launch(engine === chromium ? { args: ['--mute-audio'] } : {});
  try {
    const page = await browser.newPage({ ...options, locale: 'zh-CN' });
    page.setDefaultTimeout(20000);
    const failures = [];
    page.on('pageerror', (error) => failures.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') failures.push(message.text());
    });
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (url === `${origin}/`) {
        await route.fulfill({
          contentType: 'text/html',
          body: '<meta name="viewport" content="width=device-width, initial-scale=1"><iframe sandbox="allow-scripts" title="mini-app" src="/app" style="border:0;width:100%;height:calc(100vh - 20px)"></iframe>',
        });
      } else if (url === `${origin}/app`) {
        await route.fulfill({
          contentType: 'text/html',
          headers: {
            'content-security-policy':
              "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob: data:",
          },
          body: app,
        });
      } else if (url.startsWith('blob:')) {
        await route.continue();
      } else {
        failures.push('Unexpected browser request: ' + url);
        await route.abort();
      }
    });
    await page.goto(`${origin}/`);
    const frame = page.frameLocator('iframe');
    const find = frame.getByRole('button', { name: '查找电台' });
    await find.waitFor();
    const root = frame.locator('#root');
    const heading = frame.getByRole('heading', { level: 1 });
    const directory = frame.locator('#station-directory');
    const search = directory.getByRole('searchbox');
    const result = directory.locator(`button[data-station-id="${first[0]}"]`);
    assert.equal(await root.evaluate(() => globalThis.document.title), '声屿 HAEN');
    await expect(frame.getByTestId('globe-panel')).toHaveAttribute(
      'data-state',
      /^(ready|unavailable)$/,
      { timeout: 20000 },
    );
    const map = frame.getByTestId('globe-panel');
    if ((await map.getAttribute('data-state')) === 'unavailable') {
      await expect
        .poll(() => map.locator('img').evaluate((element) => element.naturalWidth))
        .toBeGreaterThan(0);
    }
    const assetReads = await root.evaluate(() => globalThis.assetReads);
    for (const path of [
      'data/catalog.json',
      'data/streams.json',
      'geography/land.json',
      'geography/regions.json',
      'geography/world.svg',
    ])
      assert.ok(assetReads.includes(path), path);
    await find.click();
    await expect(directory.getByTestId('directory-state')).toContainText(
      stationCount.toLocaleString('zh-CN'),
    );
    await expect(directory.getByText('目录为随微应用发布的公开电台快照。')).toBeAttached();
    await search.fill(first[1]);
    await result.click();
    await expect(heading).toHaveText(first[1]);
    await frame.getByText('此电台暂未开放站内播放。').waitFor();
    assert.equal(await frame.getByRole('button', { name: /^(播放|停止播放)$/ }).count(), 0);
    assert.equal(await frame.locator('a[href^="http"], audio, video').count(), 0);

    await frame.getByRole('button', { name: `收藏 ${first[1]}`, exact: true }).click();
    await expect
      .poll(() =>
        root.evaluate((_element, id) => {
          const data = JSON.parse(globalThis.saved['haen:ld:library:v1'] ?? '{}');
          return !!data['haen:personal:v1:favorite:' + id];
        }, first[0]),
      )
      .toBe(true)
      .catch(async (error) => {
        console.error(
          await root.evaluate(() => ({
            keys: Object.keys(globalThis.saved),
            alerts: [...globalThis.document.querySelectorAll('[role=alert]')].map(
              (node) => node.textContent,
            ),
          })),
          failures,
        );
        throw error;
      });
    const saved = await root.evaluate(() => JSON.parse(globalThis.saved['haen:ld:library:v1']));
    assert.ok(
      saved['haen:personal:v1:favorite:' + legacy[0]],
      'Preserve previous microapp favorites',
    );
    await frame.getByRole('button', { name: '我的收听' }).click();
    await expect(frame.getByRole('dialog').getByText(first[1], { exact: true })).toBeVisible();
    await frame.getByRole('button', { name: '关闭面板' }).click();

    await frame.getByText('电台详情', { exact: true }).click();
    await frame.getByRole('button', { name: /^(同城电台|附近城市的电台)$/ }).click();
    await expect(directory.getByRole('button', { name: /同城：|附近城市：/ })).toBeVisible();
    await expect(directory.locator('button[data-station-id]')).toHaveCount(sameCity.length);
    await directory.getByRole('button', { name: '只看可播' }).click();
    await expect(directory.locator('button[data-station-id]')).toHaveCount(0);
    await directory.getByRole('button', { name: '只看可播' }).click();
    await directory.getByText('筛选电台', { exact: true }).click();
    await directory.getByRole('checkbox', { name: '新闻与谈话', exact: true }).check();
    await expect(result).toBeVisible();
    await directory.getByRole('checkbox', { name: '只看收藏' }).check();
    await expect(directory.locator('button[data-station-id]')).toHaveCount(1);
    await directory.getByRole('checkbox', { name: '只看收藏' }).uncheck();
    await directory.getByRole('button', { name: '全部流派' }).click();
    await directory.getByRole('button', { name: '关闭面板' }).click();
    await frame.getByRole('button', { name: '随机下一站' }).click();
    await expect(heading).not.toHaveText(first[1]);
    await find.click();
    await directory.getByRole('button', { name: /附近城市：|同城：/ }).click();
    if (playable) {
      await search.fill(playable[1]);
      await directory.locator(`button[data-station-id="${playable[0]}"]`).click();
      await expect(heading).toHaveText(playable[1]);
      const play = frame.getByRole('button', {
        name: candidate.candidate ? '沙箱试播' : '播放',
        exact: true,
      });
      await expect(play).toBeVisible();
      if (audioSample) {
        await play.click();
        await expect
          .poll(() => root.evaluate(() => globalThis.audioEvidence.scheduled))
          .toBeGreaterThan(0);
        await frame.getByRole('button', { name: '停止播放' }).click();
        await expect.poll(() => root.evaluate(() => globalThis.audioEvidence.cancelled)).toBe(1);
        await expect(play).toBeVisible();
        console.log(
          `${label}通过：现场 MP3 样本解码为非静音数据，进入 Web Audio 调度，停止后取消流。`,
        );
      }
    }

    assert.equal(
      await root.evaluate((element) => element.scrollWidth > element.clientWidth + 1),
      false,
    );
    assert.deepEqual(await root.evaluate(() => globalThis.endpointReads), []);
    assert.equal(await frame.getByRole('button', { name: /登录/ }).count(), 0);
    assert.deepEqual(failures, []);
    assert.equal(page.context().pages().length, 1);
    console.log(`${label}通过：同一页面内的地图、包内目录、搜索、同城、筛选、收藏和随机选台。`);
  } finally {
    await browser.close();
  }
}
