import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chromium, devices, webkit } from '@playwright/test';

const archive = 'dist/check/app.zip';
const files = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .sort();
const unpack = (name) =>
  execFileSync('unzip', ['-p', archive, name], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
const manifest = JSON.parse(unpack('manifest.json'));
assert.deepEqual(
  files,
  ['manifest.json', 'index.html', 'app.js', 'app.css', 'strings.json', ...manifest.assets].sort(),
);
assert.equal('links' in manifest, false);
assert.equal(
  files.some((file) => /\.(?:mp3|aac|wav|m4a|ogg|flac)$/i.test(file)),
  false,
);
const index = unpack('index.html');
const script = unpack('app.js').replaceAll(/<\/script/gi, '<\\/script');
const css = unpack('app.css');
const assets = Object.fromEntries(manifest.assets.map((path) => [path, JSON.parse(unpack(path))]));
const first = assets['data/catalog.json'].stations[0];
const origin = 'https://ldweb-check.invalid';
const harness = `
  const resources = ${JSON.stringify(assets).replaceAll('<', '\\u003c')};
  window.AudioContext = class { constructor() { throw new Error('Audio disabled in this check'); } };
  const permissions = ${JSON.stringify(manifest.permissions)};
  let ready = false;
  window.saved = null;
  window.miniApp = {
    ready: Promise.resolve(),
    lifecycle: { ready: async () => { ready = true; } },
    assets: { readJson: async (path) => {
      if (!ready || !Object.hasOwn(resources, path)) throw new Error('Unexpected asset read');
      return resources[path];
    } },
    permissions: { has: (key) => permissions.includes(key) },
    localStorage: {
      getItem: async () => window.saved,
      setItem: async (_key, value) => { window.saved = value; },
    },
  };
`;
const app = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style>${index}<script>${harness}</script><script>${script}</script>`;

for (const { engine, label, options } of [
  { engine: chromium, label: 'Chromium 桌面', options: { viewport: { width: 1280, height: 800 } } },
  { engine: webkit, label: 'WebKit 手机视口', options: devices['iPhone 13'] },
]) {
  const browser = await engine.launch(engine === chromium ? { args: ['--mute-audio'] } : {});
  try {
    const page = await browser.newPage(options);
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
              "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
          },
          body: app,
        });
      } else {
        failures.push('Unexpected browser request');
        await route.abort();
      }
    });
    await page.goto(`${origin}/`);
    const frame = page.frameLocator('iframe');
    await frame
      .getByRole('heading', { name: '电台目录' })
      .waitFor({ timeout: 8000 })
      .catch(async (error) => {
        throw new Error(
          `${failures.join('; ')} | ${await frame
            .locator('#haen-ld-root')
            .textContent({ timeout: 1000 })
            .catch(() => 'no root')}`,
          { cause: error },
        );
      });
    assert.equal(await frame.locator('canvas').count(), 1);
    assert.equal(
      await frame
        .locator('.ld-layout')
        .evaluate(
          (element) => globalThis.getComputedStyle(element).gridTemplateColumns.split(' ').length,
        ),
      engine === webkit ? 1 : 2,
    );
    if (process.env.LDWEB_CHECK_SCREENSHOTS) {
      await page.screenshot({
        path: `${process.env.LDWEB_CHECK_SCREENSHOTS}/${engine.name()}.png`,
      });
    }
    assert.equal(
      await frame.getByRole('button', { name: /播放直播|沙箱试播|停止播放/ }).count(),
      0,
    );
    const result = frame.getByRole('list', { name: '电台列表' }).getByRole('button');
    const search = frame.getByRole('searchbox');
    await search.fill(first[1]);
    await frame
      .locator('.ld-stations strong')
      .getByText(first[1], { exact: true })
      .first()
      .waitFor();
    await result.filter({ hasText: first[1] }).first().click();
    await frame
      .getByRole('region', { name: '当前电台' })
      .getByRole('heading', { name: first[1], exact: true })
      .waitFor();
    await frame.getByRole('button', { name: '收藏当前电台' }).click();
    await frame.getByRole('button', { name: '收藏', exact: true }).click();
    assert.equal(await result.count(), 1);
    assert.equal(
      await frame.locator('body').evaluate(() => JSON.parse(globalThis.saved).length),
      1,
    );
    await frame.getByRole('button', { name: '只看可播' }).click();
    await frame.getByText('暂无开放站内播放的电台').waitFor();
    await frame.getByRole('button', { name: '浏览全部电台' }).click();
    await frame.getByRole('button', { name: '加载更多' }).click();
    assert.equal(await result.count(), 72);
    const overflow = await frame
      .locator('#haen-ld-root')
      .evaluate((element) => element.scrollWidth > element.clientWidth + 1);
    assert.equal(overflow, false);
    assert.deepEqual(failures, []);
    assert.equal(page.context().pages().length, 1);
    console.log(`${label}通过，目录、搜索、收藏、可播筛选、分页和横向布局。`);
  } finally {
    await browser.close();
  }
}
