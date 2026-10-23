import { test, expect } from '@playwright/test';
import { first, second, third, install, selectStation } from './listening-fixture.js';
import { testStation, testScene } from '../../src/testing/stations.js';
import type { StationDetail } from '@haen/contracts';

async function installMap(page: Parameters<typeof install>[0], items: StationDetail[]) {
  await install(page);
  const entries = items.map((s) => ({
    ...s,
    streams: [{ ...s.streams[0]!, url: 'https://media.haen.test/tone.mp3' }],
  }));
  const scene = testScene(entries);
  await page.route('**/api/v1/catalog**', (route) =>
    route.fulfill({
      json: route.request().url().includes('/chunks/') ? scene.chunk : scene.manifest,
    }),
  );
  await page.route(/\/api\/v1\/stations\/[0-9a-f-]{36}$/, (route) =>
    route.fulfill({ json: entries.find((s) => s.id === route.request().url().split('/').at(-1)) }),
  );
}

for (const precision of ['country', 'coordinates'] as const) {
  test(`labels Taiwan consistently when hovering a ${precision} station without selecting it`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
    const taiwan = {
      ...first,
      countryCode: 'TW',
      city: precision === 'coordinates' ? '台北' : null,
      locationPrecision: precision,
      latitude: precision === 'coordinates' ? 25.03 : null,
      longitude: precision === 'coordinates' ? 121.56 : null,
    };
    await installMap(page, [taiwan]);
    await page.goto('/?station=' + taiwan.id);
    const panel = page.getByTestId('globe-panel');
    await expect(panel).toHaveAttribute('data-state', 'ready');
    const label = page.getByTestId('selected-station-label');
    await expect(label).toHaveAttribute('data-visible', 'true');
    const point = await label.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y };
    });
    await page.mouse.move(point.x, point.y);
    await expect(
      panel.getByText(precision === 'country' ? '中国台湾 · 国家级位置' : '台北 · 中国台湾', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole('status')).toHaveAttribute('data-state', 'paused');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(taiwan.name);
    await page.screenshot({ path: info.outputPath(`taiwan-${precision}.png`) });
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await page.mouse.move(point.x, point.y);
    await expect(
      panel.getByText(
        precision === 'country' ? 'Taiwan, China · Country-level location' : '台北 · Taiwan, China',
        { exact: true },
      ),
    ).toBeVisible();
  });
}

test('browses country-only stations, paginates and distinguishes actual coordinates on both layouts', async ({
  page,
}, info) => {
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const mobile = info.project.name.startsWith('mobile-');
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  const country = [
    first,
    second,
    third,
    ...Array.from({ length: 12 }, (_, i) => testStation(i + 6)),
  ];
  const exact = {
    ...testStation(4),
    name: 'Located station',
    locationPrecision: 'coordinates' as const,
    latitude: 51.5,
    longitude: -0.1,
  };
  const unknown = {
    ...testStation(5),
    name: 'Unknown place',
    countryCode: null,
    locationPrecision: 'unknown' as const,
  };
  await installMap(page, [...country, exact, unknown]);
  await page.goto('/');
  const mapInformation = page.getByRole('button', { name: '地图信息', exact: true });
  await expect(mapInformation).toBeEnabled();
  await mapInformation.click();
  await expect(page.getByText('地图可浏览 16 / 17 台')).toBeVisible();
  await expect(page.getByText('含国家级 15 台')).toBeVisible();
  await page
    .getByRole('region', { name: '地图信息', exact: true })
    .getByRole('button', { name: '关闭面板', exact: true })
    .click();
  await selectStation(page, first.name);
  await page.locator('summary').click();
  const panel = page.getByTestId('globe-panel');
  const groupButton = page.getByRole('button', { name: '英国 · 国家级位置', exact: true });
  await expect(groupButton).toBeVisible();
  await expect(page.getByText('国家级位置', { exact: true })).toBeVisible();
  await expect(page.getByText('来源坐标', { exact: true })).toHaveCount(0);
  await groupButton.click();
  const dialog = page.getByRole('dialog', { name: '英国 · 国家级位置' });
  await expect(dialog.getByText('15 个电台', { exact: true })).toBeVisible();
  await expect(dialog.getByText('仅确定国家；空心圆汇总电台，不表示具体台址。')).toHaveCount(0);
  const firstStation = dialog.getByRole('button', { name: '收听 ' + first.name, exact: true });
  await expect(firstStation).toHaveText(first.name);
  await firstStation.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(first.name);
  await page.screenshot({ path: info.outputPath('country-station-list.png') });
  await expect(dialog.getByRole('button', { name: '附近下一站', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: '收听 Test radio 17', exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: '同国家下一站', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(second.name);
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  if ((await panel.getAttribute('data-state')) === 'ready') {
    await expect(panel.locator('canvas')).toHaveAttribute('data-marker-count', '2');
    await expect(panel.getByRole('button', { name: '定位当前电台', exact: true })).toHaveCount(0);
    const canvas = panel.getByRole('img', { name: /^可旋转的地球/ });
    await canvas.press('Home');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(second.name);
  }
  await page.screenshot({ path: info.outputPath('country-map.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await selectStation(page, exact.name);
  if ((await page.getByRole('contentinfo').locator('details').getAttribute('open')) === null)
    await page.getByText('电台详情', { exact: true }).click();
  await expect(page.getByText('来源坐标', { exact: true })).toBeVisible();
  await expect(groupButton).toHaveCount(0);
  await selectStation(page, unknown.name);
  await expect(panel.getByRole('button', { name: '定位当前电台', exact: true })).toHaveCount(0);
  await expect(page.getByText('暂无法确定地图位置，仍可通过列表收听。')).toBeVisible();
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await selectStation(page, first.name, 'en');
  await expect(
    page.getByRole('button', { name: 'United Kingdom · Country-level location' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'United Kingdom · Country-level location', exact: true })
    .click();
  const englishDialog = page.getByRole('dialog', {
    name: 'United Kingdom · Country-level location',
  });
  await expect(englishDialog.locator('p')).toHaveCount(1);
  await expect(
    englishDialog.getByRole('button', { name: 'Listen to ' + first.name, exact: true }),
  ).toHaveText(first.name);
});

test('groups unknown locations and retains every coordinate marker during expansion and power saving', async ({
  page,
}, info) => {
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize(
    info.project.name.startsWith('mobile-')
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
  );
  const countries = ['CN', 'JP', 'GB', 'CH', 'US', 'BR', 'AU'];
  const scattered = Array.from({ length: 600 }, (_, i) => ({
    ...testStation(i + 100),
    countryCode: countries[i % countries.length]!,
  }));
  const coincident = Array.from({ length: 100 }, (_, i) => ({
    ...testStation(i + 1000),
    name: `Cluster ${i}`,
    countryCode: 'CH',
    locationPrecision: 'coordinates' as const,
    latitude: 47.5,
    longitude: 7.6,
  }));
  await installMap(page, [...coincident, ...scattered]);
  await page.goto('/');
  const panel = page.getByTestId('globe-panel');
  await expect(panel).toHaveAttribute('data-state', 'ready');
  await expect(panel.locator('canvas')).toHaveAttribute('data-marker-count', '107');
  await page.screenshot({ path: info.outputPath('individual-stations.png') });
  await selectStation(page, coincident[0]!.name);
  await page.getByRole('button', { name: '100 个电台', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(panel.locator('canvas')).toHaveAttribute('data-marker-count', '107');
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  await page.getByRole('button', { name: '收听设置', exact: true }).click();
  await page.getByRole('checkbox', { name: '省电模式', exact: true }).check();
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  await expect(panel.locator('canvas')).toHaveAttribute('data-marker-count', '107');
});
