import { expect, test } from '@playwright/test';
import { first, second, install, selectStation } from './listening-fixture.js';

test.beforeEach(async ({ page }) => {
  await install(page);
  await page.addInitScript(
    (saved) => {
      sessionStorage.removeItem('haen:exploring:v1');
      localStorage.setItem('haen:language:v1', 'zh');
      localStorage.setItem('haen:personal:v1:last', JSON.stringify({ version: 1, value: saved }));
    },
    { id: first.id, name: first.name, countryCode: first.countryCode, savedAt: Date.now() },
  );
});

for (const [width, height] of [
  [1440, 900],
  [768, 1024],
  [390, 844],
  [320, 700],
  [844, 390],
]) {
  test(`keeps restored listening layout stable at ${width}x${height}`, async ({ page }, info) => {
    await page.setViewportSize({ width: width!, height: height! });
    let release!: () => void;
    let pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/v1/stations/' + first.id, async (route) => {
      await pending;
      await route.fallback();
    });
    try {
      for (const reload of [false, true]) {
        if (reload) {
          pending = new Promise<void>((resolve) => {
            release = resolve;
          });
          await page.reload({ waitUntil: 'domcontentloaded' });
        } else await page.goto('/', { waitUntil: 'domcontentloaded' });
        const title = page.getByRole('heading', { level: 1 });
        await expect(title).toHaveText(first.name);
        await expect(page.getByRole('button', { name: '查找电台', exact: true })).toBeVisible();
        await expect(page.locator('[data-intro="true"]')).toHaveCount(0);
        const play = page.getByRole('button', { name: '播放', exact: true });
        await expect(play).toBeDisabled();
        await expect(page.getByRole('status')).toHaveText('已暂停，电台信息仍在加载。');
        const before = await play.boundingBox();
        await page.screenshot({ path: info.outputPath(`pending-${reload}.png`) });
        release();
        await expect(play).toBeEnabled();
        await expect(page.getByRole('status')).toHaveAttribute('data-state', 'paused');
        await expect(title).toHaveText(first.name);
        const after = await play.boundingBox();
        expect(Math.abs(after!.x - before!.x)).toBeLessThan(1);
        expect(Math.abs(after!.y - before!.y)).toBeLessThan(1);
        expect(after!.width).toBe(before!.width);
        await expect(page.locator('audio')).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({ path: info.outputPath(`ready-${reload}.png`) });
      }
    } finally {
      release();
    }
  });
}

test('shared links never display the unrelated saved station while loading', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/stations/' + second.id, async (route) => {
    await pending;
    await route.fallback();
  });
  try {
    await page.goto('/?station=' + second.id, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-intro="true"]')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(first.name);
    await expect(page.getByRole('button', { name: '播放', exact: true })).toBeDisabled();
    release();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(second.name);
    await expect(page.locator('audio')).toHaveCount(0);
  } finally {
    release();
  }
});

test('failed restoration leaves usable exploration and no stale placeholder', async ({ page }) => {
  await page.route('**/api/v1/stations/' + first.id, (route) =>
    route.fulfill({
      status: 404,
      json: { code: 'NOT_FOUND', message: 'Fixture missing', requestId: 'fixture' },
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('button', { name: '继续探索', exact: true })).toBeVisible();
  await expect(page.locator('[data-restoring="true"]')).toHaveCount(0);
  await expect(page.locator('[data-intro="true"]')).toHaveCount(0);
  await selectStation(page, second.name);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(second.name);
});

test('an explicit selection supersedes the pending restoration', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/stations/' + first.id, async (route) => {
    await pending;
    await route.fallback();
  });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(first.name);
    await selectStation(page, second.name);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(second.name);
    release();
    await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(second.name);
    await expect(page.locator('[data-restoring="true"]')).toHaveCount(0);
  } finally {
    release();
  }
});

test('reveals the globe only after rendering and respects motion preferences', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/geography/land.json*', async (route) => {
    await pending;
    await route.continue();
  });
  try {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const globe = page.getByTestId('globe-panel');
    await expect(globe).toHaveAttribute('data-state', 'loading');
    await expect(globe.locator('img')).toBeHidden();
    await expect(page.getByRole('button', { name: '查找电台', exact: true })).toBeVisible();
    release();
    await expect(globe).toHaveAttribute('data-state', 'ready');
    const canvasHost = globe.locator('canvas').locator('..');
    await expect(canvasHost).toHaveCSS('transition-duration', '0.45s');
    await expect(canvasHost).toHaveCSS('opacity', '1');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(canvasHost).toHaveCSS('transition-duration', '0s');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByRole('button', { name: '收听设置', exact: true }).click();
    await page.getByRole('checkbox', { name: '省电模式', exact: true }).check();
    await expect(canvasHost).toHaveCSS('transition-duration', '0s');
  } finally {
    release();
  }
});
