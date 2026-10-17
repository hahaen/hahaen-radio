import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { first, second, originals, install, listenButton } from './listening-fixture.js';
async function setup(page: Page, denied = false) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('haen:personal:v1:preferences'))
      localStorage.setItem(
        'haen:personal:v1:preferences',
        JSON.stringify({
          version: 1,
          value: {
            volume: 0.2,
            muted: false,
            showHints: true,
            view: 'globe',
            idleImmersive: false,
          },
        }),
      );
    const base = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this.src.includes('/normalization.wav')) this.loop = true;
      return base.call(this);
    };
    const probe = { contexts: [] as AudioContext[], tones: 0, sources: 0 };
    Object.defineProperty(window, '__audioProbe', { value: probe });
    const Native = window.AudioContext;
    if (Native)
      window.AudioContext = class extends Native {
        constructor(...args: ConstructorParameters<typeof Native>) {
          super(...args);
          probe.contexts.push(this);
        }
        override createOscillator() {
          probe.tones++;
          return super.createOscillator();
        }
        override createMediaElementSource(media: HTMLMediaElement) {
          probe.sources++;
          return super.createMediaElementSource(media);
        }
      };
  });
  await install(page);
  await page.route(/\/api\/v1\/stations\/[a-f0-9-]{36}$/, async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1),
      station = originals.find((value) => value.id === id);
    if (!station) return route.fallback();
    return route.fulfill({
      json: {
        ...station,
        streams: [
          {
            ...station.streams[0]!,
            url: 'https://media.haen.test/normalization.wav',
            hls: false,
            codec: 'WAV',
          },
        ],
      },
    });
  });
  const body = await readFile(new URL('../fixtures/audio/normalization.wav', import.meta.url));
  let samples = 0;
  await page.route('https://media.haen.test/normalization.wav', async (route) => {
    const sampling = route.request().resourceType() === 'fetch';
    if (sampling) samples++;
    const range = route
        .request()
        .headers()
        .range?.match(/^bytes=(\d+)-(\d*)$/),
      start = range ? Number(range[1]) : 0,
      end = range?.[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
    if (start >= body.length) return route.fulfill({ status: 416, body: '' });
    await route.fulfill({
      status: range ? 206 : 200,
      body: body.subarray(start, end + 1),
      contentType: 'audio/wav',
      headers: {
        'accept-ranges': 'bytes',
        'access-control-allow-origin': denied ? 'https://denied.haen.test' : '*',
        ...(range ? { 'content-range': `bytes ${start}-${end}/${body.length}` } : {}),
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await listenButton(page, first.name).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
  return { samples: () => samples };
}
async function settings(page: Page) {
  await page.getByRole('button', { name: '收听设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '收听设置' });
  await expect(dialog).toBeVisible();
  return dialog;
}
const probe = (page: Page) =>
  page.evaluate(() => {
    const data = (
      window as unknown as {
        __audioProbe: { contexts: AudioContext[]; tones: number; sources: number };
      }
    ).__audioProbe;
    return {
      tones: data.tones,
      sources: data.sources,
      states: data.contexts.map((context) => context.state),
    };
  });
test('calibrates a decodable CORS sample without replacing the live media or overwriting user volume', async ({
  page,
  context,
}, testInfo) => {
  await page.setViewportSize(
    testInfo.project.name === 'mobile-chromium'
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
  );
  const fixture = await setup(page),
    dialog = await settings(page);
  await dialog.getByRole('checkbox', { name: '音量统一', exact: true }).check();
  await expect(dialog.getByText('正在使用本台的响度校准。', { exact: true })).toBeVisible();
  await dialog
    .getByText('默认关闭；暂停、静音或音量为零时不播放。浏览器可能需要你允许声音。', {
      exact: true,
    })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath('enhancement-settings.png'),
    animations: 'disabled',
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('audio')).toHaveCount(1);
  expect((await probe(page)).sources).toBe(0);
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.volume))
    .toBeLessThan(0.1);
  await expect(dialog.getByRole('slider', { name: '音量', exact: true })).toHaveValue('0.2');
  await dialog.getByRole('slider', { name: '音量', exact: true }).fill('0.1');
  expect(
    await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.volume),
  ).toBeLessThan(0.05);
  expect(await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(
    false,
  );
  const peer = await context.newPage();
  await install(peer);
  await peer.goto('/');
  const peerDialog = await settings(peer);
  await expect(peerDialog.getByRole('checkbox', { name: '音量统一', exact: true })).toBeChecked();
  await peerDialog.getByRole('checkbox', { name: '音量统一', exact: true }).uncheck();
  await expect(dialog.getByText('音量统一已关闭。', { exact: true })).toBeVisible();
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.volume))
    .toBeCloseTo(0.1);
  // The finite looping fixture can rebuffer; disabling must cancel all future sampling.
  const sampled = fixture.samples();
  expect(sampled).toBeGreaterThanOrEqual(1);
  await page.clock.install();
  await page.clock.fastForward(31000);
  expect(fixture.samples()).toBe(sampled);
  await peer.close();
});
test('leaves actual playback intact when the separate sample is denied by CORS', async ({
  page,
}) => {
  const fixture = await setup(page, true),
    dialog = await settings(page);
  await dialog.getByRole('checkbox', { name: '音量统一', exact: true }).check();
  await expect(dialog.getByText('此线路暂不能分析，保持原音量。', { exact: true })).toBeVisible();
  expect(
    await page.locator('audio').evaluate((audio: HTMLAudioElement) => ({
      paused: audio.paused,
      error: audio.error?.code ?? null,
      volume: audio.volume,
      cors: audio.crossOrigin,
    })),
  ).toEqual({ paused: false, error: null, volume: 0.2, cors: null });
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime))
    .toBeGreaterThan(0.1);
  expect((await probe(page)).sources).toBe(0);
  expect(fixture.samples()).toBe(1);
});
test('synthesizes only an enabled station change and suppresses sound on mute and pause', async ({
  page,
}) => {
  await setup(page);
  const dialog = await settings(page);
  await dialog.getByRole('checkbox', { name: '调台音效', exact: true }).check();
  await page.keyboard.press('Escape');
  await listenButton(page, second.name).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
  await expect.poll(async () => (await probe(page)).tones).toBe(1);
  await page.getByRole('button', { name: '静音', exact: true }).click();
  await listenButton(page, first.name).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
  expect((await probe(page)).tones).toBe(1);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect
    .poll(async () =>
      (await probe(page)).states.every((state) => state === 'suspended' || state === 'closed'),
    )
    .toBe(true);
});
test('keeps basic listening available when optional audio APIs are missing', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: undefined });
    Object.defineProperty(window, 'OfflineAudioContext', { configurable: true, value: undefined });
  });
  await setup(page);
  const dialog = await settings(page);
  await expect(dialog.getByRole('checkbox', { name: '音量统一', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('checkbox', { name: '调台音效', exact: true })).toBeDisabled();
  await expect(
    dialog.getByText('当前设备不支持部分音频增强，基础收听仍可使用。', { exact: true }),
  ).toBeVisible();
  expect(await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(
    false,
  );
});
