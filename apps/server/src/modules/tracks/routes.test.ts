import { expect, it, vi } from 'vitest';
import { NowPlayingSchema, LyricsResultSchema } from '@haen/contracts';
import { buildApp } from '../../app.js';
import { readEnvironment } from '../../config/environment.js';
import { normalizeStation } from '../catalog/normalize.js';
import { prepareSnapshot } from '../catalog/snapshot.js';
import { createCatalogService } from '../catalog/service.js';
import { testRepository } from '../../testing/catalog-repository.js';
import { createNowPlayingService } from './now-playing.js';
import { createLyricsService } from './lyrics.js';
const station = normalizeStation({
  stationuuid: '00000000-0000-4000-8000-000000000001',
  name: 'Test station',
  url: 'https://radio.example/live',
  lastcheckok: 1,
})!;
it('exposes validated station-bound metadata and fixed-provider lyrics in OpenAPI without accepting arbitrary URLs', async () => {
  const catalog = createCatalogService(testRepository(prepareSnapshot([station], []))),
    read = vi.fn<(url: string, signal?: AbortSignal) => Promise<string | null>>(
      async () => 'Harbor Artist - Night Song',
    );
  const lyrics = createLyricsService({ search: async () => [] }),
    current = createNowPlayingService(catalog, { read });
  const app = buildApp(readEnvironment({}), false, catalog, { nowPlaying: current, lyrics });
  try {
    const path = `/api/v1/stations/${station.id}/now-playing?streamId=${station.streams[0]!.id}`;
    const response = await app.inject(path);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(NowPlayingSchema.parse(response.json()).song?.title).toBe('Night Song');
    expect((await app.inject(path + '&url=https://127.0.0.1')).statusCode).toBe(400);
    expect(
      (await app.inject(`/api/v1/stations/${station.id}/now-playing?streamId=invalid`)).statusCode,
    ).toBe(400);
    expect((await app.inject('/api/v1/lyrics?artist=Harbor&title=Night')).statusCode).toBe(200);
    expect(
      LyricsResultSchema.parse(
        (await app.inject('/api/v1/lyrics?artist=Harbor&title=Night')).json(),
      ).status,
    ).toBe('not-found');
    expect((await app.inject('/api/v1/lyrics?artist=&title=Night')).statusCode).toBe(400);
    await app.ready();
    const schema = app.swagger();
    expect(schema.paths?.['/api/v1/lyrics']).toBeDefined();
    expect(schema.paths?.['/api/v1/stations/{id}/now-playing']).toBeDefined();
  } finally {
    await app.close();
  }
  expect(read.mock.calls[0]?.[1]?.aborted).toBe(true);
});
it('reports missing catalogues and unknown stream IDs without making an external request', async () => {
  const missing = buildApp(readEnvironment({}), false);
  try {
    expect(
      (
        await missing.inject(
          `/api/v1/stations/${station.id}/now-playing?streamId=${station.streams[0]!.id}`,
        )
      ).statusCode,
    ).toBe(503);
  } finally {
    await missing.close();
  }
  const catalog = createCatalogService(testRepository(prepareSnapshot([station], []))),
    read = vi.fn(async () => null);
  const app = buildApp(readEnvironment({}), false, catalog, {
    nowPlaying: createNowPlayingService(catalog, { read }),
  });
  try {
    expect(
      (await app.inject(`/api/v1/stations/${station.id}/now-playing?streamId=${'f'.repeat(24)}`))
        .statusCode,
    ).toBe(404);
    expect(read).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
