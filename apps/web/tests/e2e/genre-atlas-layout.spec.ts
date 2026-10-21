import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { GenreSchema, encodeSceneEntry } from '@haen/contracts';
import { testScene, testStation } from '../../src/testing/stations.js';
import { first, install, selectStation } from './listening-fixture.js';
import { glReport, installGLProbe } from '../performance/webgl-probe.js';

// A varied synthetic directory exercises every category without external audio or catalog writes.
const stations = GenreSchema.options.flatMap((genre, index) =>
  Array.from({ length: 1100 - index * 85 }, (_, n) => ({
    ...testStation(index * 1200 + n + 1),
    genre,
  })),
);
const data = testScene(stations);
data.manifest.chunks = Array.from({ length: Math.ceil(stations.length / 1000) }, (_, index) => ({
  index,
  count: Math.min(1000, stations.length - index * 1000),
}));

for (const [width, height] of [
  [1440, 900],
  [1496, 682],
  [768, 1024],
  [390, 844],
  [320, 700],
  [844, 390],
] as const) {
  test(`keeps every genre reachable with distinct labels at ${width}x${height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
    await installGLProbe(page);
    await install(page);
    await page.route('**/api/v1/catalog**', (route) => {
      const path = new URL(route.request().url()).pathname;
      const index = Number(path.split('/').at(-1));
      return route.fulfill({
        json: Number.isInteger(index)
          ? {
              ...data.chunk,
              index,
              entries: stations.slice(index * 1000, (index + 1) * 1000).map(encodeSceneEntry),
            }
          : data.manifest,
      });
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (/THREE.WebGLProgram|VALIDATE_STATUS|shader error/i.test(message.text()))
        errors.push(message.text());
    });
    await page.goto('/');
    // Both engines must exist before checking their independent disposal below.
    await expect(page.getByTestId('globe-panel')).toHaveAttribute('data-state', 'ready');
    await page.getByRole('button', { name: '流派', exact: true }).click();
    const atlas = page.getByRole('group', { name: '按流派探索' });
    await expect(atlas).toHaveAttribute('data-rendered', 'true');
    const buttons = atlas.locator('button[data-genre]');
    await expect(buttons).toHaveCount(11);
    await expect(buttons.last()).toBeEnabled();
    const nextPage = atlas.getByRole('button', { name: '下一页', exact: true });
    if (await nextPage.isVisible()) {
      await nextPage.click();
      await expect
        .poll(() => atlas.locator('[data-genre-grid]').evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(0);
      await expect(atlas.getByRole('button', { name: '上一页', exact: true })).toBeEnabled();
    }
    // Focus scrolls the actual grid, ensuring keyboard users can reach offscreen categories.
    for (const button of await buttons.all()) {
      await button.focus();
      await expect(button).toBeFocused();
      await expect
        .poll(
          async () => {
            const box = (await button.boundingBox())!,
              host = (await atlas.boundingBox())!;
            return box.x >= host.x - 1 && box.x + box.width <= host.x + host.width + 1;
          },
          { message: await button.innerText() },
        )
        .toBe(true);
      const box = (await button.boundingBox())!;
      const host = (await atlas.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(host.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(host.x + host.width + 1);
      expect(box.y).toBeGreaterThanOrEqual(host.y - 1);
      expect(box.y + box.height).toBeLessThanOrEqual(host.y + host.height + 1);
      const covered = await button.evaluate((element) => {
        const r = element.querySelector('span')!.getBoundingClientRect();
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return element.contains(top) ? '' : top?.outerHTML.slice(0, 220);
      });
      expect(covered, await button.innerText()).toBe('');
    }
    await buttons.first().focus();
    const boxes = await atlas.locator('button > span').evaluateAll((labels) =>
      labels.map((label) => {
        const r = label.getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
      }),
    );
    for (const [index, a] of boxes.entries())
      for (const b of boxes.slice(index + 1))
        expect(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y).toBe(true);
    await page.screenshot({ path: info.outputPath('genre-atlas.png') });
    await page.waitForTimeout(150);
    const before = await glReport(page);
    await page.waitForTimeout(200);
    expect((await glReport(page)).map((report) => report.draws)).toEqual(
      before.map((report) => report.draws),
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await buttons.last().press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').press('Escape');
    await expect(buttons.last()).toBeFocused();
    const cloudContext = (await glReport(page)).at(-1)!;
    await page.getByRole('button', { name: '地球', exact: true }).click();
    await expect(atlas).toHaveCount(0);
    await expect
      .poll(
        async () => (await glReport(page)).find((report) => report.id === cloudContext.id)?.lost,
      )
      .toBe(true);
    const disposed = (await glReport(page)).find((report) => report.id === cloudContext.id)!;
    expect(Object.values(disposed.resources).every((counts) => counts.live === 0)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
}

test('keeps the current genre and paused playback across language changes and WebGL fallback', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    if (!localStorage.getItem('haen:language:v1')) localStorage.setItem('haen:language:v1', 'zh');
  });
  await install(page);
  await page.goto('/');
  await selectStation(page, first.name);
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByRole('button', { name: '流派', exact: true }).click();
  const atlas = page.locator('[data-mode="genres"] [data-genre="jazz"]').first();
  await expect(atlas).toHaveAttribute('aria-current', 'true');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Explore by genre' })).toBeVisible();
  await expect(atlas).toHaveAccessibleName('Jazz 1 station');
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'paused');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
      ...args: unknown[]
    ) {
      if (kind.startsWith('webgl')) return null;
      return Reflect.apply(original, this, [kind, ...args]);
    } as typeof original;
  });
  await page.reload();
  const fallback = page.getByRole('group', { name: 'Explore by genre' });
  await expect(fallback.locator('canvas')).toHaveCount(0);
  await expect(atlas).toHaveAttribute('aria-current', 'true');
  await expect(atlas.locator('[data-genre-fallback]')).toBeVisible();
  await atlas.click();
  await expect(page.getByRole('dialog', { name: 'Jazz', exact: true })).toBeVisible();
  await page.getByRole('dialog').press('Escape');
  await expect(atlas).toBeFocused();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'paused');
});

test('keeps enlarged English captions above navigation on a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'en'));
  await install(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Genre', exact: true }).click();
  const atlas = page.getByRole('group', { name: 'Explore by genre' });
  await expect(atlas).toHaveAttribute('data-rendered', 'true');
  await page.addStyleTag({
    content:
      '[data-genre] > span {font-size:28px!important} [data-genre] > small {font-size:20px!important}',
  });
  const captions = await atlas.locator('button[data-genre] > span').evaluateAll((labels) =>
    labels.map((label) => {
      const r = label.getBoundingClientRect();
      return { x: r.x, right: r.right };
    }),
  );
  for (const [index, a] of captions.entries())
    for (const b of captions.slice(index + 1)) expect(a.right <= b.x || b.right <= a.x).toBe(true);
  for (const button of await atlas.locator('button[data-genre]:enabled').all()) {
    await button.focus();
    await expect
      .poll(() =>
        button.evaluate((element) => {
          const grid = element.closest('[data-genre-grid]')!.getBoundingClientRect();
          const label = element.querySelector('span')!.getBoundingClientRect();
          const count = element.querySelector('small')!.getBoundingClientRect();
          return (
            label.top >= grid.top - 1 &&
            count.bottom <= grid.bottom + 1 &&
            element.contains(
              document.elementFromPoint(label.x + label.width / 2, label.y + label.height / 2),
            )
          );
        }),
      )
      .toBe(true);
  }
});
