import { expect, test } from '@playwright/test';
import { testScene, testStation } from '../../src/testing/stations.js';
import { install, openDirectory, originals } from './listening-fixture.js';

for (const fallback of [false, true]) {
  test(`excludes religious stations and choices with ${fallback ? 'API fallback' : 'scene catalog'}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(
      testInfo.project.name === 'mobile-chromium'
        ? { width: 390, height: 844 }
        : { width: 1440, height: 900 },
    );
    await install(page, !fallback);
    await page.addInitScript(() => {
      localStorage.setItem(
        'haen:personal:v1:filters',
        JSON.stringify({
          version: 1,
          value: {
            q: '',
            genres: ['religious'],
            languages: null,
            minBitrate: 0,
            favoritesOnly: false,
          },
        }),
      );
    });
    const stations = [
      ...originals,
      { ...testStation(4), name: 'Faith radio', genre: 'religious' as const },
    ];
    if (!fallback) {
      const scene = testScene(stations);
      await page.route('**/api/v1/catalog/scene**', (route) =>
        route.fulfill({
          json: route.request().url().endsWith('/scene') ? scene.manifest : scene.chunk,
        }),
      );
    }
    await page.route('**/api/v1/stations?**', (route) => {
      const params = new URL(route.request().url()).searchParams;
      const genres = params.get('genres')?.split(',');
      expect(genres).toBeDefined();
      expect(genres).not.toContain('religious');
      const matches = stations.filter((station) => genres?.includes(station.genre));
      const offset = Number(params.get('offset'));
      const limit = Number(params.get('limit'));
      return route.fulfill({
        json: {
          items: matches.slice(offset, offset + limit),
          total: matches.length,
          offset,
          limit,
        },
      });
    });
    await page.goto('/');
    await page.getByRole('button', { name: '中文', exact: true }).click();
    await openDirectory(page);
    await expect(page.getByTestId('directory-state')).toHaveText('找到 3 个电台');
    await expect(page.getByText('Faith radio', { exact: true })).toHaveCount(0);
    await page.locator('#station-directory summary').click();
    await expect(page.getByRole('checkbox', { name: '宗教', exact: true })).toHaveCount(0);
    await page.getByRole('checkbox', { name: '爵士', exact: true }).check();
    await expect(page.getByTestId('directory-state')).toHaveText('找到 1 个电台');
    await page.getByRole('button', { name: '清除全部条件', exact: true }).click();
    await expect(page.getByTestId('directory-state')).toHaveText('找到 3 个电台');
    await page.keyboard.press('Escape');
    await expect(page.locator('nav button[data-genre="religious"]')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('all-stations.png') });
  });
}
