import { expect, test } from '@playwright/test';
import { first, install } from './listening-fixture.js';

test('dismisses floating tools when the globe is zoomed or dragged without changing playback', async ({
  page,
}, info) => {
  await page.setViewportSize(
    info.project.name === 'mobile-chromium'
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await install(page);
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
  await page.goto('/?station=' + first.id);
  await expect(page.getByTestId('globe-panel')).toHaveAttribute('data-state', 'ready');
  const canvas = page.getByTestId('globe-panel').locator('canvas');
  const bounds = (await canvas.boundingBox())!;
  const x = bounds.x + (info.project.name === 'mobile-chromium' ? 8 : bounds.width * 0.2);
  const y = bounds.y + bounds.height * 0.25;
  for (const name of ['查找电台', '我的收听', '收听设置', '关于与帮助']) {
    await page.getByRole('button', { name, exact: true }).click();
    if (name === '查找电台') await expect(page.getByRole('searchbox')).toBeVisible();
    else await expect(page.getByRole('dialog')).toBeVisible();
    await page.mouse.move(x, y);
    await page.mouse.wheel(0, -40);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('#station-directory')).toHaveCount(0);
  }
  const filters = page.getByRole('navigation', { name: '流派', exact: true });
  await filters.getByRole('button', { name: '筛选电台', exact: true }).click();
  await expect(page.getByRole('region', { name: '筛选电台', exact: true })).toBeVisible();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 20, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByRole('region', { name: '筛选电台', exact: true })).toHaveCount(0);
  const notes = page.getByRole('button', { name: '地图信息', exact: true });
  await notes.click();
  await expect(notes).toHaveAttribute('aria-expanded', 'true');
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, 40);
  await expect(notes).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(first.name);
});
