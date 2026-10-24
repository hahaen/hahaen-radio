import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { first, install, selectStation } from './listening-fixture.js';

for (const [width, height] of [
  [1440, 900],
  [390, 844],
  [320, 700],
] as const) {
  test(`enters exploration from the welcome screen at ${width}x${height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    await install(page);
    await page.addInitScript(() => {
      sessionStorage.removeItem('haen:exploring:v1');
      localStorage.setItem('haen:language:v1', 'zh');
    });
    await page.goto('/');
    const browse = page.getByRole('button', { name: '先逛逛星图', exact: true });
    await expect(browse).toBeVisible();
    await expect(page.locator('header').getByText('嗯，听听世界。', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '开始收听', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: '查找电台', exact: true })).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page.getByTestId('globe-panel')).toHaveAttribute(
      'data-state',
      /^(ready|unavailable)$/,
    );
    await page.screenshot({ path: info.outputPath('welcome.png') });
    await browse.click();
    await expect(browse).toHaveCount(0);
    await expect(page.getByRole('button', { name: '查找电台', exact: true })).toBeVisible();
    await selectStation(page, first.name);
    await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await expect(page.getByRole('status')).toHaveAttribute('data-state', 'paused');
  });
}

test('does not start a foreign station when the initial China pool is empty', async ({ page }) => {
  await install(page);
  await page.addInitScript(() => {
    sessionStorage.removeItem('haen:exploring:v1');
    localStorage.setItem('haen:language:v1', 'zh');
  });
  await page.goto('/');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: '开始收听', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('没有其他可尝试的电台，可手动选择或重试。');
  await expect(page.locator('audio')).toHaveCount(0);
  await page.getByRole('button', { name: '先逛逛星图', exact: true }).click();
  await expect(page.getByRole('button', { name: '查找电台', exact: true })).toBeVisible();
});

test('reveals the first visit with a finite entrance and respects reduced motion', async ({
  page,
}) => {
  await install(page);
  await page.addInitScript(() => {
    sessionStorage.removeItem('haen:exploring:v1');
    localStorage.setItem('haen:language:v1', 'zh');
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const copy = page.getByRole('region', { name: '当前电台', exact: true });
  await expect(copy.getByRole('heading')).toBeVisible();
  expect(await copy.evaluate((el) => getComputedStyle(el).animationName)).not.toBe('none');
  await expect
    .poll(() =>
      copy.evaluate((el) =>
        el.getAnimations().every((animation) => animation.playState === 'finished'),
      ),
    )
    .toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(copy.getByRole('heading')).toBeVisible();
  expect(await copy.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await page.getByRole('button', { name: '先逛逛星图', exact: true }).click();
  await expect(page.getByRole('button', { name: '查找电台', exact: true })).toBeVisible();
});
