import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium, devices, expect, webkit } from '@playwright/test';

const archive = 'dist/check/app.zip';
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
assert.deepEqual(manifest.permissions, ['storage.read', 'storage.write']);
assert.equal('endpoints' in manifest || 'links' in manifest, false);
assert.equal(
  files.some((file) => /\.(?:mp3|aac|wav|m4a|ogg|flac)$/i.test(file)),
  false,
);

const index = unpack('index.html').toString();
const script = unpack('app.js').toString();
const css = unpack('app.css').toString();
const snapshot = unpack('data/catalog.json');
assert.deepEqual(snapshot, readFileSync('data/catalog.json'));
assert.deepEqual(JSON.parse(unpack('data/streams.json')), []);
const { stations, stationCount } = JSON.parse(snapshot);
assert.equal(stationCount, stations.length);
const cityKey = (entry) =>
  JSON.stringify(
    [entry[2], entry[3] ?? '', entry[4] ?? entry[5]].map((s) =>
      s?.normalize('NFKC').trim().toLowerCase(),
    ),
  );
const cities = new Map();
for (const entry of stations) {
  if (entry[2] && (entry[4] || entry[5])) {
    const key = cityKey(entry);
    cities.set(key, (cities.get(key) ?? 0) + 1);
  }
}
const first = stations.find(
  (entry) =>
    entry[2] &&
    (entry[4] || entry[5]) &&
    entry[8] === 'coordinates' &&
    entry[9] === 'news' &&
    cities.get(cityKey(entry)) > 1,
);
assert.ok(first, 'The published directory should contain a testable station with a city');
const legacy = stations.find((entry) => entry[0] !== first[0]);

const origin = 'https://linuxdo-check.invalid';
const resources = Object.fromEntries(
  manifest.assets.map((path) => [
    path,
    path.startsWith('data/') ? JSON.parse(unpack(path)) : unpack(path).toString('base64'),
  ]),
);
const harness = `
  const resources = ${JSON.stringify(resources).replaceAll('<', '\\u003c')};
  const permissions = ${JSON.stringify(manifest.permissions)};
  const storage = { 'haen:ld:favorites:v1': ${JSON.stringify(JSON.stringify([legacy[0]]))} };
  let ready = false;
  window.assetReads = [];
  window.saved = storage;
  window.AudioContext = window.webkitAudioContext = class {
    constructor() { throw new Error('Audio is disabled during this check'); }
  };
  HTMLMediaElement.prototype.play = () => { throw new Error('Media is disabled during this check'); };
  window.fetch = () => { throw new Error('Unexpected browser fetch'); };
  window.miniApp = {
    ready: Promise.resolve(),
    lifecycle: { ready: async () => { ready = true; } },
    assets: {
      readJson: async (path) => read(path),
      readBytes: async (path) => Uint8Array.from(atob(read(path)), (c) => c.charCodeAt(0)),
    },
    http: { stream: () => { throw new Error('Unexpected stream request'); } },
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
const app = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style>${index}<script>${harness}</script><script>${script}</script>`;

for (const { engine, label, options } of [
  { engine: chromium, label: 'Chromium 桌面', options: { viewport: { width: 1280, height: 800 } } },
  { engine: webkit, label: 'WebKit 手机视口', options: devices['iPhone 13'] },
]) {
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
    await expect(directory.getByTestId('directory-state')).toContainText(
      cities.get(cityKey(first)).toLocaleString('zh-CN'),
    );
    await directory.getByRole('button', { name: '只看可播' }).click();
    await expect(directory.locator('button[data-station-id]')).toHaveCount(0);
    await directory.getByRole('button', { name: '只看可播' }).click();
    await directory.getByText('筛选电台', { exact: true }).click();
    await directory.getByRole('checkbox', { name: '新闻与谈话', exact: true }).check();
    await expect(result).toBeVisible();
    await directory.getByRole('checkbox', { name: '只看收藏' }).check();
    await expect(directory.locator('button[data-station-id]')).toHaveCount(1);
    await directory.getByRole('checkbox', { name: '只看收藏' }).uncheck();
    await directory.getByRole('button', { name: '关闭面板' }).click();
    await frame.getByRole('button', { name: '随机下一站' }).click();
    await expect(heading).not.toHaveText(first[1]);

    assert.equal(
      await root.evaluate((element) => element.scrollWidth > element.clientWidth + 1),
      false,
    );
    assert.deepEqual(failures, []);
    assert.equal(page.context().pages().length, 1);
    console.log(`${label}通过：同一页面内的地图、快照、搜索、同城、筛选、收藏和随机选台。`);
  } finally {
    await browser.close();
  }
}
