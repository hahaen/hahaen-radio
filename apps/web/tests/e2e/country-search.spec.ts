import { expect, test } from '@playwright/test';
import { testScene, testStation } from '../../src/testing/stations.js';
import { install, openDirectory, listenButton } from './listening-fixture.js';

test('China searches include Taiwan in the complete station collection', async ({
  page,
}, testInfo) => {
  await install(page);
  const stations = [
    { ...testStation(1), name: '北京测试电台', countryCode: 'CN', city: '北京' },
    { ...testStation(2), name: '台北测试电台', countryCode: 'TW', city: '台北' },
    { ...testStation(3), name: '东京测试电台', countryCode: 'JP', city: '东京' },
  ];
  const scene = testScene(stations);
  await page.route('**/api/v1/catalog**', (route) =>
    route.fulfill({
      json: /\/(?:catalog|scene)$/.test(new URL(route.request().url()).pathname)
        ? scene.manifest
        : scene.chunk,
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await openDirectory(page);
  await expect(page.getByTestId('directory-state')).toHaveText('找到 3 个电台');
  const search = page.getByRole('searchbox', { name: '搜索电台' });
  for (const q of ['中国', 'China', 'CN']) {
    await search.fill(q);
    await search.press('Enter');
    await expect(page.getByTestId('directory-state')).toHaveText('找到 2 个电台');
    await expect(listenButton(page, stations[0]!.name)).toBeVisible();
    await expect(listenButton(page, stations[1]!.name)).toBeVisible();
    await expect(listenButton(page, stations[2]!.name)).toHaveCount(0);
  }
  await search.fill('中国');
  await search.press('Enter');
  await page.screenshot({ path: testInfo.outputPath('china-search.png'), fullPage: true });
  await search.fill('中国 台北');
  await search.press('Enter');
  await expect(page.getByTestId('directory-state')).toHaveText('找到 1 个电台');
  await expect(listenButton(page, stations[1]!.name)).toBeVisible();
  await search.fill('台湾');
  await search.press('Enter');
  await expect(page.getByTestId('directory-state')).toHaveText('找到 1 个电台');
  await expect(listenButton(page, stations[1]!.name)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
