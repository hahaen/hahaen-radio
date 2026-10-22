import { expect, test } from '@playwright/test';
import { install, openDirectory } from './listening-fixture.js';
import { testScene, testStation } from '../../src/testing/stations.js';

const entries = Array.from({ length: 390 }, (_, index) => testStation(index + 1));
const scene = testScene(entries);

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 768, height: 1024 },
  { width: 440, height: 956 },
  { width: 390, height: 844 },
  { width: 320, height: 700 },
  { width: 844, height: 390 },
]) {
  test(`numbered station pages fit ${viewport.width}x${viewport.height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
    await install(page);
    await page.route('**/api/v1/catalog**', (route) =>
      route.fulfill({
        json: route.request().url().includes('/chunks/') ? scene.chunk : scene.manifest,
      }),
    );
    await page.goto('/');
    await openDirectory(page);
    const panel = page.locator('#station-directory');
    const nav = panel.getByRole('navigation', { name: '电台分页' });
    await expect(nav.getByRole('button', { name: '第 1 页', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(nav.getByRole('button', { name: '上一页' })).toBeDisabled();
    await nav.scrollIntoViewIfNeeded();
    await expect.poll(() => nav.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    if (viewport.width === 1440) {
      for (const number of [1, 2, 3, 4, 5, 13]) {
        await expect(
          nav.getByRole('button', { name: `第 ${number} 页`, exact: true }),
        ).toBeVisible();
      }
    }
    await page.screenshot({ path: info.outputPath('pagination-first.png') });
    await nav.getByRole('button', { name: '第 3 页', exact: true }).click();
    await expect(nav.getByRole('button', { name: '第 3 页', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(panel.locator('[data-station-id]').first()).toContainText('Test radio 61');
    await nav.getByRole('button', { name: '下一页' }).click();
    await expect(panel.locator('[data-station-id]').first()).toContainText('Test radio 91');
    await nav.getByRole('button', { name: '上一页' }).click();
    await expect(panel.locator('[data-station-id]').first()).toContainText('Test radio 61');
    for (const number of [4, 5, 6, 7]) {
      await nav.getByRole('button', { name: `第 ${number} 页`, exact: true }).click();
      await expect(
        nav.getByRole('button', { name: `第 ${number + 1} 页`, exact: true }),
      ).toBeVisible();
    }
    if (viewport.width === 1440) {
      await nav.getByRole('button', { name: '第 13 页', exact: true }).click();
      await expect(panel.locator('[data-station-id]').first()).toContainText('Test radio 361');
      await expect(nav.getByRole('button', { name: '下一页' })).toBeDisabled();
      for (let step = 0; step < 5; step += 1) {
        await nav.getByRole('button', { name: '上一页' }).click();
      }
      await expect(nav.getByRole('button', { name: '第 8 页', exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await page.screenshot({ path: info.outputPath('pagination-middle.png') });
    }
    await panel.getByRole('searchbox').fill('Test radio 390');
    await expect(panel.locator('[data-station-id]')).toHaveCount(1);
    await expect(nav).toHaveCount(0);
    await panel.getByRole('searchbox').fill('');
    await expect(nav.getByRole('button', { name: '第 1 页', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await panel.getByRole('searchbox').fill('no-matching-station');
    await expect(panel.locator('[data-station-id]')).toHaveCount(0);
    await expect(nav).toHaveCount(0);
  });
}

test('numbered pages request the matching remote offset and retain keyboard navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'en'));
  await install(page, false);
  await page.route('**/api/v1/stations?**', async (route) => {
    const offset = Number(new URL(route.request().url()).searchParams.get('offset'));
    await route.fulfill({
      json: { items: entries.slice(offset, offset + 30), total: entries.length, offset, limit: 30 },
    });
  });
  await page.goto('/');
  await openDirectory(page);
  const nav = page.getByRole('navigation', { name: 'Station pages' });
  const fifth = nav.getByRole('button', { name: 'Page 5', exact: true });
  await fifth.focus();
  await fifth.press('Enter');
  await expect(page.locator('#station-directory [data-station-id]').first()).toContainText(
    'Test radio 121',
  );
  await expect(nav.getByRole('button', { name: 'Page 5', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await nav.getByRole('button', { name: 'Page 13', exact: true }).click();
  await expect(page.locator('#station-directory [data-station-id]').first()).toContainText(
    'Test radio 361',
  );
  await expect(nav.getByRole('button', { name: 'Next page' })).toBeDisabled();
});
