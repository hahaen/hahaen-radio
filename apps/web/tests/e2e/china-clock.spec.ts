import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { first, second, install, selectStation } from './listening-fixture.js';

test.use({ timezoneId: 'America/New_York' });

for (const [width, height] of [
  [1440, 900],
  [390, 844],
  [320, 700],
  [844, 390],
] as const) {
  test(`shows China time and date across station changes at ${width}x${height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    await page.clock.setFixedTime(new Date('2026-10-18T13:27:00Z'));
    await install(page);
    await page.addInitScript(() => {
      sessionStorage.removeItem('haen:exploring:v1');
      localStorage.setItem('haen:language:v1', 'zh');
    });
    await page.goto('/');
    const clock = page.getByRole('complementary', { name: '中国时间', exact: true });
    await expect(clock).toBeVisible();
    await expect(clock.getByText('21:27', { exact: true })).toBeVisible();
    await expect(clock).toContainText(/2026年10月18日\s*星期日/);
    await expect(clock.getByText('农历九月初九', { exact: true })).toBeVisible();
    await expect(clock).not.toContainText('—');
    await selectStation(page, first.name);
    await selectStation(page, second.name);
    await expect(page.getByRole('heading', { name: second.name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await expect(clock.getByText('21:27', { exact: true })).toBeVisible();
    await expect(clock.locator('time')).toHaveText(
      /^21:27中国时间 · 2026年10月18日\s*星期日农历九月初九$/,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const clockBounds = await clock.boundingBox();
    expect(clockBounds!.x).toBeGreaterThanOrEqual(0);
    expect(clockBounds!.y).toBeGreaterThanOrEqual(0);
    expect(clockBounds!.x + clockBounds!.width).toBeLessThanOrEqual(width);
    expect(clockBounds!.y + clockBounds!.height).toBeLessThanOrEqual(height);
    const locationHint = await page
      .getByText('仅确定国家；空心点不代表真实台址。', { exact: true })
      .boundingBox();
    if (locationHint) {
      expect(
        clockBounds!.y + clockBounds!.height <= locationHint.y ||
          locationHint.y + locationHint.height <= clockBounds!.y ||
          clockBounds!.x + clockBounds!.width <= locationHint.x ||
          locationHint.x + locationHint.width <= clockBounds!.x,
      ).toBe(true);
    }
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath('china-clock.png') });
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    const english = page.getByRole('complementary', { name: 'China time', exact: true });
    await expect(english).toContainText('21:27');
    await expect(english).toContainText('Sunday, 18 October 2026');
    await expect(english.getByText('Lunar: month 9, day 9', { exact: true })).toBeVisible();
    const englishBounds = await english.boundingBox();
    expect(englishBounds!.x).toBeGreaterThanOrEqual(0);
    expect(englishBounds!.x + englishBounds!.width).toBeLessThanOrEqual(width);
  });
}

test('shows a leap lunar month across languages', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2025-07-25T00:00:00Z'));
  await install(page);
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
  await page.goto('/');
  const clock = page.getByRole('complementary', { name: '中国时间', exact: true });
  await expect(clock.getByText('农历闰六月初一', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'China time', exact: true })).toContainText(
    'Lunar: leap month 6, day 1',
  );
});
