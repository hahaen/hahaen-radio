import { expect, test } from '@playwright/test';
import { installScale } from './scale-fixture.js';
import { glReport, installGLProbe } from '../performance/webgl-probe.js';

test('keeps the full globe responsive and idle drawing bounded after brightness changes', async ({
  page,
}, info) => {
  await page.setViewportSize(
    info.project.name === 'mobile-chromium'
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (/THREE.WebGLProgram|VALIDATE_STATUS|shader error/i.test(message.text()))
      errors.push(message.text());
  });
  await installGLProbe(page);
  await installScale(page);
  await page.goto('/');
  const panel = page.getByTestId('globe-panel');
  await expect(panel).toHaveAttribute('data-state', 'ready');
  const canvas = panel.locator('canvas');
  await expect(canvas).toHaveAttribute('data-marker-count', '30000');
  await expect(canvas).toHaveAttribute('data-relief', /^(ready|unavailable)$/, { timeout: 15000 });
  await expect.poll(async () => (await glReport(page))[0]?.draws ?? 0).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath('global.png') });
  await canvas.press('ArrowLeft');
  await canvas.press('ArrowUp');
  await canvas.press('+');
  await page.screenshot({ path: info.outputPath('zoomed.png') });
  await canvas.press('-');
  await canvas.press('Home');
  // Reduced motion must settle; brightness changes must not introduce continuous draws.
  await page.waitForTimeout(250);
  const settled = (await glReport(page))[0]!;
  await page.waitForTimeout(250);
  expect((await glReport(page))[0]!.draws).toBe(settled.draws);
  const box = await canvas.boundingBox();
  const cap = box!.width < 768 ? 1.5 : 1.75;
  expect(settled.width).toBeLessThanOrEqual(Math.ceil(box!.width * cap) + 1);
  expect(settled.height).toBeLessThanOrEqual(Math.ceil(box!.height * cap) + 1);
  await page.getByRole('button', { name: '收听设置', exact: true }).click();
  await page.getByRole('checkbox', { name: '省电模式', exact: true }).check();
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-marker-count', '30000');
  await page.screenshot({ path: info.outputPath('power-save.png') });
  const powered = (await glReport(page))[0]!;
  expect(powered.width).toBeLessThanOrEqual(Math.ceil(box!.width) + 1);
  expect(powered.height).toBeLessThanOrEqual(Math.ceil(box!.height) + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
