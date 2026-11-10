import { expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { readEnvironment } from '../../config/environment.js';
import { testRepository } from '../../testing/catalog-repository.js';
import { normalizeStation } from './normalize.js';
import { createCatalogService } from './service.js';
import { prepareSnapshot } from './snapshot.js';

it('serves the website catalog over fixed endpoints scoped to the LINUX DO origin', async () => {
  const station = normalizeStation({
    stationuuid: '00000000-0000-4000-8000-000000000001',
    name: 'Radio test',
    url: 'https://radio.example/live',
    lastcheckok: 1,
  })!;
  const snapshot = prepareSnapshot([station], []);
  const repository = testRepository(snapshot);
  const app = buildApp(readEnvironment({}), false, createCatalogService(repository));
  const origin = 'https://linux.do';
  const call = (path: string) =>
    app.inject({ url: '/api/v1/linuxdo/' + path, headers: { origin } });
  try {
    const scene = await call('scene');
    expect(scene.headers['access-control-allow-origin']).toBe(origin);
    expect(scene.json()).toEqual((await app.inject('/api/v1/catalog/scene')).json());
    const chunk = await call('chunk?index=0&version=' + snapshot.manifest.version);
    expect(chunk.json()).toEqual(
      (await app.inject(`/api/v1/catalog/scene/${snapshot.manifest.version}/chunks/0`)).json(),
    );
    const detail = await call('stations?ids=' + station.id);
    expect(detail.json().items).toEqual([
      (await app.inject('/api/v1/stations/' + station.id)).json(),
    ]);
    const invalid = await call('stations?ids=broken');
    expect(invalid.statusCode).toBe(400);
    expect(invalid.headers['access-control-allow-origin']).toBe(origin);
    expect(
      (
        await app.inject({
          url: '/api/v1/linuxdo/scene',
          headers: { origin: 'https://example.org' },
        })
      ).headers['access-control-allow-origin'],
    ).toBeUndefined();
    expect(
      (await app.inject({ url: '/api/v1/catalog/scene', headers: { origin } })).headers[
        'access-control-allow-origin'
      ],
    ).toBeUndefined();
  } finally {
    await app.close();
  }
});
