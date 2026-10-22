import { expect, test, type Page } from '@playwright/test';
import { install, openDirectory } from './listening-fixture.js';
import { testScene, testStation } from '../../src/testing/stations.js';

const entries = Array.from({ length: 75 }, (_, index) => testStation(index + 1));
const scene = testScene(entries);

async function setup(page: Page, local: boolean) {
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await install(page, local);
  if (local) {
    await page.route('**/api/v1/catalog**', (route) =>
      route.fulfill({
        json: route.request().url().includes('/chunks/') ? scene.chunk : scene.manifest,
      }),
    );
  }
  await page.route(/\/api\/v1\/stations\/[0-9a-f-]{36}$/, (route) => {
    const station = entries.find((entry) => route.request().url().endsWith(entry.id))!;
    return route.fulfill({
      json: {
        ...station,
        streams: [{ ...station.streams[0], url: 'https://media.haen.test/tone.mp3' }],
      },
    });
  });
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 320, height: 700 },
  { width: 844, height: 390 },
]) {
  test(`appends local results to the last station at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await setup(page, true);
    await page.goto('/');
    await openDirectory(page);
    const panel = page.locator('#station-directory');
    const rows = panel.locator('[data-station-id]');
    const footer = panel.getByTestId('station-load-more');
    const scroll = panel.getByRole('region', { name: '电台列表', exact: true });
    await expect(rows).toHaveCount(30);
    await expect(panel.getByRole('navigation')).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    await rows.first().evaluate((element) => element.setAttribute('data-retained', 'true'));
    for (const count of [60, 75]) {
      await scroll.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      const before = await scroll.evaluate((element) => element.scrollTop);
      await expect(rows).toHaveCount(count);
      expect(
        Math.abs((await scroll.evaluate((element) => element.scrollTop)) - before),
      ).toBeLessThanOrEqual(2);
      await expect(rows.first()).toHaveAttribute('data-retained', 'true');
    }
    await footer.scrollIntoViewIfNeeded();
    await expect(footer.getByRole('button', { name: '已到列表末尾' })).toBeDisabled();
    await expect(rows.last()).toContainText('Test radio 75');
    expect(
      await rows.evaluateAll(
        (elements) =>
          new Set(elements.map((element) => element.getAttribute('data-station-id'))).size,
      ),
    ).toBe(75);
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath('station-list-end.png') });
    await panel.getByRole('searchbox').fill('Test radio 75');
    await expect(rows).toHaveCount(1);
    await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBe(0);
    await panel.getByRole('searchbox').fill('no-such-station');
    await expect(rows).toHaveCount(0);
    await expect(footer).toHaveCount(0);
    await panel.getByRole('searchbox').fill('');
    await expect(rows).toHaveCount(30);
    await scroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(rows).toHaveCount(60);
    await scroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(rows).toHaveCount(75);
    await rows.last().click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Test radio 75');
  });
}

test('retains remote rows while loading and retrying, and stops requesting at the end', async ({
  page,
}, info) => {
  await page.setViewportSize(
    info.project.name === 'mobile-chromium'
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
  );
  await setup(page, false);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let failLast = true;
  const requests: number[] = [];
  await page.route('**/api/v1/stations?**', async (route) => {
    const offset = Number(new URL(route.request().url()).searchParams.get('offset'));
    requests.push(offset);
    if (offset === 30) await pending;
    if (offset === 60 && failLast)
      return route.fulfill({
        status: 503,
        json: { code: 'SERVICE_UNAVAILABLE', message: 'Fixture failure', requestId: 'fixture' },
      });
    await route.fulfill({
      json: { items: entries.slice(offset, offset + 30), total: entries.length, offset, limit: 30 },
    });
  });
  await page.goto('/');
  await openDirectory(page);
  const panel = page.locator('#station-directory');
  const rows = panel.locator('[data-station-id]');
  const scroll = panel.getByRole('region', { name: '电台列表', exact: true });
  const footer = panel.getByTestId('station-load-more');
  await expect(rows).toHaveCount(30);
  const initialHeight = (await panel.boundingBox())!.height;
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect.poll(() => requests.includes(30)).toBe(true);
  await expect(footer.getByRole('button', { name: '正在加载更多…' })).toBeDisabled();
  await expect(rows).toHaveCount(30);
  expect((await panel.boundingBox())!.height).toBe(initialHeight);
  await scroll.evaluate((element) => {
    element.scrollTop -= 10;
    element.scrollTop += 10;
  });
  expect(requests.filter((offset) => offset === 30)).toHaveLength(1);
  await page.screenshot({ path: info.outputPath('station-list-loading.png') });
  release();
  await expect(rows).toHaveCount(60);
  await expect(rows.first()).toContainText('Test radio 1');
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const retry = footer.getByRole('button', { name: '重试加载' });
  await expect(retry).toBeVisible();
  await expect(rows).toHaveCount(60);
  expect(requests.filter((offset) => offset === 60)).toHaveLength(2);
  failLast = false;
  await retry.click();
  await expect(rows).toHaveCount(75);
  await footer.scrollIntoViewIfNeeded();
  await expect(footer.getByRole('button', { name: '已到列表末尾' })).toBeDisabled();
  expect(requests.filter((offset) => offset > 0)).toEqual([30, 60, 60, 60]);
});

test('discards an old batch after changing search and resets the scroll position', async ({
  page,
}) => {
  await setup(page, false);
  let release!: () => void;
  let finish!: () => void;
  let started = false;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route('**/api/v1/stations?**', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const offset = Number(params.get('offset'));
    if (params.get('q'))
      return route.fulfill({ json: { items: [entries[74]], total: 1, offset: 0, limit: 30 } });
    if (offset === 30) {
      started = true;
      await pending;
    }
    await route.fulfill({
      json: { items: entries.slice(offset, offset + 30), total: entries.length, offset, limit: 30 },
    });
    if (offset === 30) finish();
  });
  await page.goto('/');
  await openDirectory(page);
  const panel = page.locator('#station-directory');
  const scroll = panel.getByRole('region', { name: '电台列表', exact: true });
  const rows = panel.locator('[data-station-id]');
  await expect(rows).toHaveCount(30);
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect.poll(() => started).toBe(true);
  await panel.getByRole('searchbox').fill('Test radio 75');
  await expect(rows).toHaveCount(1);
  release();
  await finished;
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Test radio 75');
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBe(0);
});

test('supports keyboard loading when scroll observation is unavailable', async ({ page }) => {
  await setup(page, true);
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'IntersectionObserver');
  });
  await page.goto('/');
  await openDirectory(page);
  const panel = page.locator('#station-directory');
  const rows = panel.locator('[data-station-id]');
  await expect(rows).toHaveCount(30);
  const more = panel.getByRole('button', { name: '加载更多电台' });
  await more.focus();
  await more.press('Enter');
  await expect(rows).toHaveCount(60);
  await expect(more).toBeFocused();
  await more.press('Enter');
  await expect(rows).toHaveCount(75);
  await expect(panel.getByRole('button', { name: '已到列表末尾' })).toBeFocused();
});

test('deduplicates overlapping batches and stops safely on an empty response', async ({ page }) => {
  await setup(page, false);
  const requests: number[] = [];
  await page.route('**/api/v1/stations?**', async (route) => {
    const offset = Number(new URL(route.request().url()).searchParams.get('offset'));
    requests.push(offset);
    const items = offset === 0 ? entries.slice(0, 30) : offset === 30 ? entries.slice(29, 59) : [];
    await route.fulfill({ json: { items, total: 75, offset, limit: 30 } });
  });
  await page.goto('/');
  await openDirectory(page);
  const panel = page.locator('#station-directory');
  const rows = panel.locator('[data-station-id]');
  const scroll = panel.getByRole('region', { name: '电台列表', exact: true });
  await expect(rows).toHaveCount(30);
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(rows).toHaveCount(59);
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(panel.getByRole('button', { name: '已到列表末尾' })).toBeVisible();
  await expect(rows).toHaveCount(59);
  expect(requests.filter((offset) => offset > 0)).toEqual([30, 60]);
});
