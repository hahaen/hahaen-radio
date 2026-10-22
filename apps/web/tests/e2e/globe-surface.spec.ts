import { expect, test } from '@playwright/test';

test('draws surface markers on the front hemisphere without leaking through the globe', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/surface-harness', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>canvas{display:block;width:100%;height:100%}</style></head><body style="margin:0;overflow:hidden;background:#081310"><div id="host" style="width:100vw;height:100vh"></div></body></html>',
    }),
  );
  await page.goto('/surface-harness');
  await page.evaluate(async () => {
    const globeUrl = '/src/graphics/globe.ts';
    const landUrl = '/src/graphics/land.ts';
    const modelUrl = '/src/graphics/model.ts';
    const fixtureUrl = '/src/testing/stations.ts';
    const [globe, land, model, fixture] = await Promise.all([
      import(globeUrl) as Promise<typeof import('../../src/graphics/globe.js')>,
      import(landUrl) as Promise<typeof import('../../src/graphics/land.js')>,
      import(modelUrl) as Promise<typeof import('../../src/graphics/model.js')>,
      import(fixtureUrl) as Promise<typeof import('../../src/testing/stations.js')>,
    ]);
    const engine = globe.createGlobe(
      document.getElementById('host')!,
      await land.loadLand(new AbortController().signal),
      {
        label: 'Surface verification',
        pick() {},
        preview() {},
        lost() {},
        restored() {},
      },
    );
    engine.setData([]);
    Reflect.set(window, 'surfaceVerification', {
      engine,
      setPoint(front: boolean) {
        engine.setData(
          model.groupStations([
            {
              ...fixture.testStation(1),
              countryCode: null,
              latitude: front ? 25 : -25,
              longitude: front ? 80 : -100,
              locationPrecision: 'coordinates',
            },
          ]),
        );
      },
    });
  });
  const settle = () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  await settle();
  const canvas = page.locator('canvas');
  const pixels = (png: Buffer) =>
    page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (value) => value.charCodeAt(0));
      const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const surface = document.createElement('canvas');
      surface.width = image.width;
      surface.height = image.height;
      const context = surface.getContext('2d')!;
      context.drawImage(image, 0, 0);
      image.close();
      const values = context.getImageData(0, 0, surface.width, surface.height).data;
      let hash = 2166136261;
      for (const value of values) hash = Math.imul(hash ^ value, 16777619);
      return hash >>> 0;
    }, png.toString('base64'));
  // The front point and its antipode both project to this patch; ignore unrelated coastline rasterization noise.
  const patch = { x: 384, y: 284, width: 32, height: 32 };
  const empty = await pixels(
    await page.screenshot({ clip: patch, path: info.outputPath('empty.png') }),
  );
  await page.evaluate(() =>
    (Reflect.get(window, 'surfaceVerification') as { setPoint(front: boolean): void }).setPoint(
      false,
    ),
  );
  await settle();
  expect(
    await pixels(await page.screenshot({ clip: patch, path: info.outputPath('back.png') })),
  ).toBe(empty);
  await page.evaluate(() =>
    (Reflect.get(window, 'surfaceVerification') as { setPoint(front: boolean): void }).setPoint(
      true,
    ),
  );
  await settle();
  expect(
    await pixels(await page.screenshot({ clip: patch, path: info.outputPath('front.png') })),
  ).not.toBe(empty);
  await page.evaluate(() =>
    (
      Reflect.get(window, 'surfaceVerification') as { engine: { destroy(): void } }
    ).engine.destroy(),
  );
  await expect(canvas).toHaveCount(0);
});
