import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { installScale, stations } from './scale-fixture.js';
import { installGLProbe } from '../performance/webgl-probe.js';

for (const refreshRate of [60, 120]) {
  test(`keeps idle playback animation continuous on a ${refreshRate} Hz display`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await installGLProbe(page);
    await page.route('**/frame-pacing-harness', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body><div id="host" style="width:360px;height:360px"></div></body></html>',
      }),
    );
    await page.goto('/frame-pacing-harness');
    const result = await page.evaluate(async (refreshRate) => {
      const moduleUrl = '/src/graphics/globe.ts';
      const { createGlobe } = (await import(
        moduleUrl
      )) as typeof import('../../src/graphics/globe.js');
      const originalRequest = window.requestAnimationFrame;
      const originalCancel = window.cancelAnimationFrame;
      const originalNow = performance.now.bind(performance);
      const callbacks = new Map<number, FrameRequestCallback>();
      let time = 1000,
        sequence = 0;
      window.requestAnimationFrame = (callback) => {
        callbacks.set(++sequence, callback);
        return sequence;
      };
      window.cancelAnimationFrame = (id) => {
        callbacks.delete(id);
      };
      performance.now = () => time;
      const engine = createGlobe(
        document.getElementById('host')!,
        { version: 1, points: [], polygons: [] },
        {
          label: 'Frame pacing test',
          pick() {},
          preview() {},
          lost() {},
          restored() {},
        },
      );
      const frame = () => {
        time += 1000 / refreshRate;
        const pending = [...callbacks.values()];
        callbacks.clear();
        for (const callback of pending) callback(time);
      };
      try {
        engine.setPlaying(true);
        for (let i = 0; i < 60; i++) frame();
        let previous = window.__haenGLReport()[0]!.draws;
        const painted: number[] = [];
        for (let i = 0; i < 60; i++) {
          frame();
          const draws = window.__haenGLReport()[0]!.draws;
          if (draws > previous) painted.push(i);
          previous = draws;
        }
        return { requestedFrames: 60, paintedFrames: painted.length, painted };
      } finally {
        engine.destroy();
        window.requestAnimationFrame = originalRequest;
        window.cancelAnimationFrame = originalCancel;
        performance.now = originalNow;
      }
    }, refreshRate);
    await info.attach('frame-pacing', {
      body: JSON.stringify(result),
      contentType: 'application/json',
    });
    expect(result.paintedFrames, JSON.stringify(result)).toBeGreaterThanOrEqual(55);
  });
}

test('uses browser frames while playback is idle with a full station catalog', async ({
  page,
}, info) => {
  test.setTimeout(60000);
  await page.setViewportSize(
    info.project.name === 'mobile-chromium'
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await installGLProbe(page);
  await installScale(page);
  await page.addInitScript(() => localStorage.setItem('haen:language:v1', 'zh'));
  await page.goto('/?station=' + stations[20017]!.id);
  const panel = page.getByTestId('globe-panel');
  await expect(panel).toHaveAttribute('data-state', 'ready');
  await expect(panel.locator('canvas')).toHaveAttribute('data-marker-count', '30000');
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
  await page.waitForTimeout(1200);
  const sample = await page.evaluate(
    () =>
      new Promise<{
        paintedFrames: number;
        browserFrames: number;
        elapsed: number;
        renderer: string;
        pixels: number;
      }>((resolve) => {
        const canvas = document.querySelector('canvas')!;
        const gl = canvas.getContext('webgl2')!;
        const debug = gl.getExtension('WEBGL_debug_renderer_info');
        const renderer = String(
          gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
        );
        let previous = window.__haenGLReport()[0]!.draws;
        let paintedFrames = 0,
          browserFrames = 0;
        const started = performance.now();
        const frame = (now: number) => {
          const draws = window.__haenGLReport()[0]!.draws;
          if (draws > previous) paintedFrames++;
          previous = draws;
          if (++browserFrames === 60)
            resolve({
              paintedFrames,
              browserFrames,
              elapsed: now - started,
              renderer,
              pixels: canvas.width * canvas.height,
            });
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
  );
  await writeFile(info.outputPath('native-frame-pacing.json'), JSON.stringify(sample));
  await info.attach('native-frame-pacing', {
    body: JSON.stringify(sample),
    contentType: 'application/json',
  });
  expect(sample.paintedFrames, JSON.stringify(sample)).toBeGreaterThanOrEqual(55);
});
