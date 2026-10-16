import { afterEach, describe, expect, it, vi } from 'vitest';
import { SceneChunkSchema, SceneManifestSchema, StationSearchSchema } from '@haen/contracts';
import { buildApp } from '../../app.js';
import { readEnvironment } from '../../config/environment.js';
import { normalizeStation } from './normalize.js';
import { prepareSnapshot } from './snapshot.js';
import { createCatalogService } from './service.js';
import { testRepository } from '../../testing/catalog-repository.js';

const first = normalizeStation({
  stationuuid: '00000000-0000-4000-8000-000000000001',
  name: 'Café Jazz',
  countrycode: 'FR',
  url: 'https://radio.example/live',
  tags: 'jazz',
  languagecodes: 'fr',
  bitrate: 192,
  lastcheckok: 1,
})!;
const second = normalizeStation({
  ...{},
  stationuuid: '00000000-0000-4000-8000-000000000002',
  name: 'News Station',
  url: 'https://radio.example/news',
  tags: 'news',
  languagecodes: 'en',
  bitrate: 128,
  lastcheckok: 1,
})!;
const snapshot = prepareSnapshot([first, second], []);
afterEach(() => vi.useRealTimers());
describe('catalogue API contracts with an in-memory test repository', () => {
  it('supports the manifest, versioned summary chunks, filters, lookup and playback candidates', async () => {
    const app = buildApp(
      readEnvironment({}),
      false,
      createCatalogService(testRepository(snapshot)),
    );
    try {
      const manifest = await app.inject('/api/v1/catalog');
      expect(manifest.statusCode).toBe(200);
      expect(manifest.json()).toMatchObject({ stationCount: 2, playableCount: 2 });
      const chunk = await app.inject(`/api/v1/catalog/${snapshot.manifest.version}/chunks/0`);
      expect(chunk.json().items[0].streams).toBeUndefined();
      const sceneManifest = SceneManifestSchema.parse(
        (await app.inject('/api/v1/catalog/scene')).json(),
      );
      const scene = SceneChunkSchema.parse(
        (await app.inject(`/api/v1/catalog/scene/${sceneManifest.version}/chunks/0`)).json(),
      );
      expect(scene.entries).toHaveLength(2);
      expect(scene.restrictionsRevision).toBe(sceneManifest.restrictionsRevision);
      expect(scene.entries[0]).toHaveLength(13);
      expect(JSON.stringify(scene)).not.toContain('https://radio.example/');
      const search = await app.inject(
        '/api/v1/stations?q=cafe&genres=jazz,news&languages=fr&minBitrate=192',
      );
      expect(search.json().items.map((item: { id: string }) => item.id)).toEqual([first.id]);
      expect((await app.inject('/api/v1/stations?genres=')).json().total).toBe(0);
      expect((await app.inject('/api/v1/stations?minBitrate=129')).statusCode).toBe(400);
      const lookup = await app.inject({
        method: 'POST',
        url: '/api/v1/stations/lookup',
        payload: { ids: [first.id, first.id, '00000000-0000-4000-8000-000000000099'] },
      });
      expect(lookup.json().items).toHaveLength(1);
      expect(lookup.json().missing).toHaveLength(1);
      expect(
        (await app.inject(`/api/v1/stations/${first.id}/streams`)).json().streams,
      ).toHaveLength(1);
      expect((await app.inject(`/api/v1/stations/${first.id}/same-city`)).json().items).toEqual([]);
      expect((await app.inject('/api/v1/health/ready')).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
  it('keeps each compact chunk tied to the exact restrictions used to build its entries', async () => {
    vi.useFakeTimers();
    const repository = testRepository(snapshot);
    vi.mocked(repository.overrides).mockResolvedValue(new Set([first.id]));
    const service = createCatalogService(repository);
    const initial = await service.sceneManifest();
    let ready: () => void = () => {},
      finish: () => void = () => {};
    const waiting = new Promise<void>((resolve) => {
      ready = resolve;
    });
    vi.mocked(repository.sceneChunk).mockImplementation(async () => {
      ready();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return [first, second];
    });
    const loading = service.sceneChunk(snapshot.manifest.version, 0);
    await waiting;
    vi.mocked(repository.overrides).mockResolvedValue(new Set());
    await vi.advanceTimersByTimeAsync(5001);
    const updated = await service.sceneManifest();
    finish();
    const chunk = await loading;
    expect(chunk.restrictionsRevision).toBe(initial.restrictionsRevision);
    expect(chunk.entries[0]?.[12]).toBe('blocked');
    expect(updated.restrictionsRevision).not.toBe(initial.restrictionsRevision);
  });
  it('returns truthful not-ready states and does not expose a fake catalogue', async () => {
    const app = buildApp(readEnvironment({}), false);
    try {
      expect((await app.inject('/api/v1/health/ready')).statusCode).toBe(503);
      expect((await app.inject('/api/v1/catalog')).json().code).toBe('SERVICE_UNAVAILABLE');
    } finally {
      await app.close();
    }
    const service = createCatalogService(testRepository());
    expect(await service.readiness()).toMatchObject({ database: true, catalog: false });
  });
  it('applies manual blocks to both current and cached old versions and restores them after cache expiry', async () => {
    vi.useFakeTimers();
    const repository = testRepository(snapshot);
    vi.mocked(repository.overrides).mockResolvedValue(new Set([first.id]));
    const service = createCatalogService(repository);
    expect(await service.station(first.id)).toMatchObject({ availability: 'blocked', streams: [] });
    expect((await service.manifest()).playableCount).toBe(1);
    expect((await service.chunk(snapshot.manifest.version, 0)).items[0]?.availability).toBe(
      'blocked',
    );
    vi.mocked(repository.overrides).mockResolvedValue(new Set());
    await vi.advanceTimersByTimeAsync(5001);
    expect((await service.station(first.id)).streams).toHaveLength(1);
    expect(
      (await service.search(StationSearchSchema.parse({ genres: 'jazz', languages: 'en' }))).total,
    ).toBe(0);
  });
});
