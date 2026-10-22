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
    if (width < 768 && height >= 600) {
      const controls = [
        '上一站',
        '播放',
        '随机下一站',
        '固定当前电台',
        '收藏 ' + name,
        '沉浸收听',
        '分享',
        '静音',
      ];
      for (const label of controls) {
        const button = page.getByRole('button', { name: label, exact: true });
        const box = await button.boundingBox();
        expect(Math.round(box!.width * 100) / 100).toBeGreaterThanOrEqual(44);
        expect(Math.round(box!.height * 100) / 100).toBeGreaterThanOrEqual(44);
        await expect(button).toBeInViewport();
      }
    }
    const current = page.getByRole('region', { name: '当前电台', exact: true });
    const heading = await current.getByRole('heading').boundingBox();
    const bounds = await current.boundingBox();
    expect(heading!.y).toBeGreaterThanOrEqual(bounds!.y);
    expect(heading!.y + heading!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height + 1);
    await expect(page.getByTestId('globe-panel')).toHaveAttribute('data-state', 'ready');
    await expect(page.getByTestId('globe-panel').locator('canvas')).toHaveAttribute(
      'data-marker-count',
      '1',
    );
    if (width <= 360 || height <= 500)
      await expect(page.getByTestId('selected-station-label').locator('strong')).toBeHidden();
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
      page
        .getByTestId('globe-panel')
        .getByText('仅确定国家；空心圆汇总电台，不表示具体台址。', { exact: true })
        .or(page.getByTestId('globe-panel').getByText('3 个电台', { exact: true })),
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

for (const language of ['zh', 'en'] as const) {
  test(`keeps cached map information quiet without redundant copy in ${language}`, async ({
    page,
  }) => {
    await install(page);
    await page.addInitScript((value) => localStorage.setItem('haen:language:v1', value), language);
    await page.goto('/');
    const canvas = page.getByTestId('globe-panel').locator('canvas');
    await expect(canvas).toHaveAttribute('data-marker-count', '1');
    await page.route('**/api/v1/catalog/scene', (route) => route.abort());
    await page.reload();
    await expect(canvas).toHaveAttribute('data-marker-count', '1');
    const name = language === 'zh' ? '地图信息' : 'Map information';
    const toggle = page.getByRole('button', { name, exact: true });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    const details = page.getByRole('region', { name, exact: true });
    await expect(details).toContainText(
      language === 'zh' ? '地图可浏览 3 / 3 台' : '3 / 3 stations on the map',
    );
    await expect(
      page.getByText('拖动旋转，滚轮或双指缩放；方向键也可移动。', { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText('Drag to rotate. Scroll or pinch to zoom. Arrow keys also move the globe.', {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByText('当前使用缓存目录，电台状态可能已有变化。', { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText('Using a cached directory. Station availability may have changed.', {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Natural Earth', exact: true })).toHaveCount(0);
  });
}
