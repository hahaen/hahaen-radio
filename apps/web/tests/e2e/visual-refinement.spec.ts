import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { first, install, selectStation } from './listening-fixture.js';

for (const [width, height] of [
  [1440, 900],
  [390, 844],
  [320, 700],
  [844, 390],
] as const) {
  test(`keeps long station names and map information usable at ${width}x${height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
    await install(page);
    const name = '广西文艺广播 FM950广西音乐台';
    await page.route('**/api/v1/stations/' + first.id, (route) =>
      route.fulfill({
        json: {
          ...first,
          name,
          streams: [{ ...first.streams[0]!, url: 'https://media.haen.test/tone.mp3' }],
        },
      }),
    );
    await page.goto('/');
    await selectStation(page, first.name);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    const current = page.getByRole('region', { name: '当前电台', exact: true });
    const heading = await current.getByRole('heading').boundingBox();
    const bounds = await current.boundingBox();
    expect(heading!.y).toBeGreaterThanOrEqual(bounds!.y);
    expect(heading!.y + heading!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height + 1);
    await expect(page.getByTestId('globe-panel')).toHaveAttribute('data-state', 'ready');
    await expect(page.getByTestId('globe-panel').locator('canvas')).toHaveAttribute(
      'data-marker-count',
      '3',
    );
    const toggle = page.getByRole('button', { name: '地图信息', exact: true });
    const details = page.getByRole('region', { name: '地图信息', exact: true });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(details).toBeHidden();
    await toggle.click();
    await expect(details.getByText('地图可浏览 3 / 3 台', { exact: true })).toBeVisible();
    const close = details.getByRole('button', { name: '关闭面板', exact: true });
    expect(
      await close.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return el.contains(
          document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
        );
      }),
    ).toBe(true);
    await close.focus();
    await close.press('Escape');
    await expect(details).toBeHidden();
    await expect(toggle).toBeFocused();
    await expect(
      page.getByText('仅确定国家；空心点不代表真实台址。', { exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath('refined-listening.png') });
  });
}

test('shows a scene failure and its retry action without opening map information', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
  await install(page, false);
  await page.goto('/');
  const toggle = page.getByRole('button', { name: '地图信息', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const details = page.getByRole('region', { name: '地图信息', exact: true });
  await expect(details).toBeVisible();
  await expect(details.getByRole('button', { name: '重试', exact: true })).toBeVisible();
});
