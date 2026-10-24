import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { testStation, testScene } from '../../src/testing/stations.js';

const china = {
  ...testStation(2),
  countryCode: 'CN',
  name: '中国测试电台',
  streams: [{ ...testStation(2).streams[0]!, url: 'https://media.haen.test/tone.mp3' }],
};
const abroad = { ...testStation(1), name: '中国之声 abroad' };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
  await page.route('**/api/v1/account/session', (route) => route.fulfill({ json: { user: null } }));
  const scene = testScene([abroad, china]);
  await page.route('**/api/v1/catalog/scene**', (route) =>
    route.fulfill({
      json: route.request().url().endsWith('/scene') ? scene.manifest : scene.chunk,
    }),
  );
  await page.route('**/api/v1/stations**', (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      json: url.pathname.endsWith('/stations')
        ? { items: [abroad, china], total: 2, offset: 0, limit: 100 }
        : url.pathname.endsWith(china.id)
          ? china
          : abroad,
    });
  });
});

for (const [width, height] of [
  [1440, 900],
  [390, 844],
  [320, 700],
  [844, 390],
]) {
  test(`first entry preselects China silently at ${width}x${height}`, async ({ page }, info) => {
    await page.setViewportSize({ width: width!, height: height! });
    const mediaRequests: string[] = [];
    await page.route('https://media.haen.test/**', async (route) => {
      mediaRequests.push(route.request().url());
      await route.fulfill({
        body: await readFile(new URL('../fixtures/audio/tone.mp3', import.meta.url)),
        contentType: 'audio/mpeg',
      });
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(china.name);
    await expect(page.getByRole('status')).toHaveAttribute('data-state', 'paused');
    await expect(page.locator('audio')).toHaveCount(0);
    expect(mediaRequests).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath('china-paused.png') });
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(china.name);
    expect(mediaRequests.length).toBeGreaterThan(0);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(china.name);
    await expect(page.locator('audio')).toHaveCount(0);
  });
}

test('an explicit shared station overrides the initial China default and remains paused', async ({
  page,
}) => {
  await page.goto('/?station=' + abroad.id);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(abroad.name);
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'paused');
  await expect(page.locator('audio')).toHaveCount(0);
});
