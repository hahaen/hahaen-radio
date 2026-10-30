import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { testStation, testScene } from '../../src/testing/stations.js';

test.beforeEach(async ({ page }) => {
  const station = testStation(1);
  const scene = testScene([station]);
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = path.endsWith('/account/session')
      ? { user: null }
      : path.endsWith('/random-china')
        ? { station: null }
        : path.includes('/catalog')
          ? path.includes('/chunks/')
            ? scene.chunk
            : scene.manifest
          : { items: [station], total: 1, offset: 0, limit: 30 };
    return route.fulfill({ json });
  });
  await page.addInitScript(() => {
    localStorage.setItem('haen:language:v1', 'zh');
    sessionStorage.setItem('haen:exploring:v1', 'true');
  });
});

for (const [width, height] of [
  [1440, 900],
  [390, 844],
  [320, 700],
  [844, 390],
] as const) {
  test(`requires updating and preserves browser data at ${width}x${height}`, async ({
    page,
    request,
  }, info) => {
    await page.setViewportSize({ width, height });
    const current = (await (await request.get('/radio/version.json')).json()).version as string;
    let version = current;
    let offline = false;
    let checks = 0;
    await page.route('**/version.json?*', (route) => {
      checks++;
      return offline ? route.abort('failed') : route.fulfill({ json: { version } });
    });
    await page.clock.install();
    await page.goto('/radio/?keep=1#listening');
    await expect.poll(() => checks).toBeGreaterThan(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.evaluate(() => localStorage.setItem('haen:update-test', 'preserved'));
    version = 'f'.repeat(32);
    await page.clock.fastForward(60_000);
    const dialog = page.getByRole('dialog', { name: '发现新版本' });
    const update = dialog.getByRole('button', { name: '立即更新' });
    await expect(dialog).toBeVisible();
    await expect(update).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await page.mouse.click(2, 2);
    await expect(dialog).toBeVisible();
    await update.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath('version-update.png') });
    offline = true;
    await update.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/keep=1/);
    offline = false;
    // The served bundle becomes current again after the simulated deployment's reload.
    await page.route('**/radio/?*', async (route) => {
      if (route.request().isNavigationRequest()) version = current;
      await route.continue();
    });
    await update.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL('/radio/?keep=1#listening');
    expect(await page.evaluate(() => localStorage.getItem('haen:update-test'))).toBe('preserved');
    expect(await page.evaluate(() => sessionStorage.getItem('haen:exploring:v1'))).toBe('true');
  });
}

test('ignores maintenance and checks again when the page resumes, with English copy', async ({
  page,
  request,
}) => {
  const current = (await (await request.get('/radio/version.json')).json()).version as string;
  let valid = false;
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'en'));
  await page.route('**/version.json?*', (route) =>
    valid
      ? route.fulfill({
          json: { version: current === 'e'.repeat(32) ? 'd'.repeat(32) : 'e'.repeat(32) },
        })
      : route.fulfill({ status: 503, body: '<html>Maintenance</html>' }),
  );
  await page.clock.install();
  await page.goto('/radio/');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.clock.fastForward(6000);
  valid = true;
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await expect(page.getByRole('dialog', { name: 'A new version is available' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Update now' })).toBeVisible();
});
