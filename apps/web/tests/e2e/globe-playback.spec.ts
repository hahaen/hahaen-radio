import { expect, test } from '@playwright/test';
import { installScale, stations } from './scale-fixture.js';
import { glReport, installGLProbe } from '../performance/webgl-probe.js';

test('animates station lights during playback and settles when paused or motion is reduced', async ({
  page,
}, info) => {
  await page.setViewportSize(
    info.project.name === 'mobile-chromium'
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await installScale(page);
  await installGLProbe(page);
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
  const errors: string[] = [];
  page.on('console', (message) => {
    if (/THREE.WebGLProgram|VALIDATE_STATUS|shader error/i.test(message.text()))
      errors.push(message.text());
  });
  await page.goto('/?station=' + stations[20017]!.id);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(stations[20017]!.name);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
  const panel = page.getByTestId('globe-panel');
  await expect(panel).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('selected-station-label')).toHaveAttribute('data-visible', 'true');
  await page.screenshot({ path: info.outputPath('station-lights.png') });
  const report = async () => (await glReport(page))[0]!;
  const start = (await report()).draws;
  await expect.poll(async () => (await report()).draws).toBeGreaterThan(start + 3);
  const bounds = (await panel.locator('canvas').boundingBox())!;
  const clip = {
    x: bounds.x + bounds.width * 0.25,
    y: bounds.y + bounds.height * 0.48,
    width: bounds.width * 0.1,
    height: bounds.height * 0.1,
  };
  const before = await page.screenshot({ clip });
  await page.waitForTimeout(650);
  const after = await page.screenshot({ clip });
  expect(before.equals(after)).toBe(false);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.waitForTimeout(300);
  const paused = (await report()).draws;
  await page.waitForTimeout(250);
  expect((await report()).draws).toBe(paused);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect.poll(async () => (await report()).draws).toBeGreaterThan(paused + 3);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(300);
  const reduced = (await report()).draws;
  await page.waitForTimeout(250);
  expect((await report()).draws).toBe(reduced);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: '收听设置', exact: true }).click();
  await page.getByRole('checkbox', { name: '省电模式', exact: true }).check();
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  await page.waitForTimeout(300);
  const powered = (await report()).draws;
  await page.waitForTimeout(250);
  expect((await report()).draws).toBe(powered);
  await expect(panel.locator('canvas')).toHaveAttribute('data-marker-count', '30000');
  expect(errors).toEqual([]);
});
