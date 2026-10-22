import { expect, test } from '@playwright/test';
import { first, install } from './listening-fixture.js';

for (const available of [true, false]) {
  test(`keeps the map usable with shaded relief ${available ? 'loaded' : 'unavailable'}`, async ({
    page,
  }) => {
    await install(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (/THREE.WebGLProgram|VALIDATE_STATUS|shader error/i.test(message.text()))
        errors.push(message.text());
    });
    if (!available)
      await page.route('**/geography/relief.jpg*', (route) =>
        route.fulfill({ status: 404, body: '' }),
      );
    await page.goto('/?station=' + first.id);
    const panel = page.getByTestId('globe-panel');
    await expect(panel).toHaveAttribute('data-state', 'ready', { timeout: 15000 });
    const canvas = panel.locator('canvas');
    await expect(canvas).toHaveAttribute('data-relief', available ? 'ready' : 'unavailable');
    await expect(canvas).not.toHaveAttribute('data-marker-count', '0');
    await canvas.press('ArrowLeft');
    await canvas.press('+');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(first.name);
    expect(errors).toEqual([]);
  });
}
