import { expect, test } from '@playwright/test';
import { first, install, selectStation } from './listening-fixture.js';
import { testScene, testStation } from '../../src/testing/stations.js';

for (const mode of ['animated', 'reduced', 'power-save'] as const) {
  test(`centers the playing station and follows station changes in ${mode} mode`, async ({
    page,
  }, info) => {
    test.setTimeout(60000);
    await page.setViewportSize(
      info.project.name === 'mobile-chromium'
        ? { width: 390, height: 844 }
        : { width: 1440, height: 900 },
    );
    await page.emulateMedia({ reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference' });
    await install(page);
    await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
    const entries = [
      { countryCode: 'AU', latitude: -33.87, longitude: 151.21, name: 'Sydney' },
      { countryCode: 'US', latitude: 40.71, longitude: -74.01, name: 'New York' },
      { countryCode: 'CN', latitude: null, longitude: null, name: 'Country station' },
      { countryCode: null, latitude: null, longitude: null, name: 'Unknown location' },
    ].map((station, index) => ({
      ...testStation(index + 1),
      ...station,
      locationPrecision:
        station.latitude === null ? ('country' as const) : ('coordinates' as const),
      streams: [{ ...testStation(index + 1).streams[0]!, url: 'https://media.haen.test/tone.mp3' }],
    }));
    const scene = testScene(entries);
    await page.route('**/api/v1/catalog**', (route) =>
      route.fulfill({
        json: route.request().url().includes('/chunks/') ? scene.chunk : scene.manifest,
      }),
    );
    await page.route('**/api/v1/stations**', (route) => {
      const url = new URL(route.request().url());
      return route.fulfill({
        json:
          url.pathname === '/api/v1/stations'
            ? { items: entries, total: entries.length, offset: 0, limit: 30 }
            : url.pathname.endsWith('/lookup')
              ? { items: entries, missing: [] }
              : entries.find((station) => station.id === url.pathname.split('/').at(-1)),
      });
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/?station=' + entries[0]!.id);
    const panel = page.getByTestId('globe-panel');
    await expect(panel).toHaveAttribute('data-state', 'ready');
    const canvas = panel.locator('canvas');
    const label = page.getByTestId('selected-station-label');
    const offset = () =>
      label.evaluate((element) => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
        const canvas = element.parentElement!.querySelector('canvas')!;
        const bounds = canvas.getBoundingClientRect();
        return Math.hypot(
          matrix.m41 - bounds.width * (innerWidth >= 1024 ? 0.59 : 0.5),
          matrix.m42 - bounds.height / 2,
        );
      });
    const centered = async () => {
      await expect(label).toHaveAttribute('data-visible', 'true');
      await expect.poll(offset).toBeLessThan(1);
    };
    if (mode === 'power-save') {
      await page.getByRole('button', { name: '收听设置', exact: true }).click();
      await page.getByRole('checkbox', { name: '省电模式', exact: true }).check();
      await page.keyboard.press('Escape');
    }
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
    await centered();
    await page.waitForTimeout(1000);
    expect(await offset()).toBeLessThan(1);
    await page.screenshot({ path: info.outputPath('centered-sydney.png') });

    // Pinning keeps manual exploration from selecting a different station.
    await page.getByRole('button', { name: '固定当前电台', exact: true }).click();
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await canvas.press('ArrowLeft');
    await expect.poll(offset).toBeGreaterThan(10);
    await page.waitForTimeout(700);
    const exploredOffset = await offset();
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await page.waitForTimeout(1200);
    expect(Math.abs((await offset()) - exploredOffset)).toBeLessThan(1);

    for (const station of entries.slice(1, 3)) {
      await selectStation(page, station.name);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(station.name);
      await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
      await centered();
    }
    for (const [width, height] of [
      [768, 1024],
      [320, 700],
      [844, 390],
    ]) {
      await page.setViewportSize({ width: width!, height: height! });
      await centered();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: info.outputPath(`centered-${width}x${height}.png`) });
    }
    await selectStation(page, entries[3]!.name);
    await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
    await expect(label).toHaveAttribute('data-visible', 'false');
    await expect(page.locator('audio')).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}

test('centers an already playing station when the globe finishes loading', async ({ page }) => {
  await install(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/geography/land.json*', async (route) => {
    await ready;
    await route.continue();
  });
  await page.goto('/');
  await selectStation(page, first.name);
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
  await expect(page.getByTestId('globe-panel')).toHaveAttribute('data-state', 'loading');
  release();
  await expect(page.getByTestId('globe-panel')).toHaveAttribute('data-state', 'ready');
  const label = page.getByTestId('selected-station-label');
  await expect(label).toHaveAttribute('data-visible', 'true');
  await expect
    .poll(() =>
      label.evaluate((element) => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
        const bounds = element.parentElement!.querySelector('canvas')!.getBoundingClientRect();
        return Math.hypot(
          matrix.m41 - bounds.width * (innerWidth >= 1024 ? 0.59 : 0.5),
          matrix.m42 - bounds.height / 2,
        );
      }),
    )
    .toBeLessThan(1);
});
