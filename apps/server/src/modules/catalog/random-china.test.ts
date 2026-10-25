import { afterEach, describe, expect, it, vi } from 'vitest';
import { RandomStationResultSchema } from '@haen/contracts';
import { buildApp } from '../../app.js';
import { readEnvironment } from '../../config/environment.js';
import { normalizeStation } from './normalize.js';
import { prepareSnapshot } from './snapshot.js';
import { createCatalogService } from './service.js';
import { testRepository } from '../../testing/catalog-repository.js';

function station(index: number, countrycode = 'CN', tags = 'jazz', lastcheckok = 1) {
  return normalizeStation({
    stationuuid: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    name: '中国测试电台',
    countrycode,
    tags,
    lastcheckok,
    url: `https://radio.example/${index}.mp3`,
  })!;
}
afterEach(() => vi.restoreAllMocks());
describe('single-request initial China selection', () => {
  it('selects across all eligible stations and returns streams without downloading result pages', async () => {
    const stations = Array.from({ length: 150 }, (_, i) => station(i + 1));
    const repository = testRepository(prepareSnapshot(stations, []));
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const app = buildApp(readEnvironment({}), false, createCatalogService(repository));
    try {
      const result = await app.inject('/api/v1/stations/random-china');
      expect(result.statusCode).toBe(200);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(RandomStationResultSchema.parse(result.json()).station).toEqual(stations.at(-1));
      expect(repository.query).toHaveBeenCalledTimes(2);
      expect(
        vi.mocked(repository.query).mock.calls.map(([query]) => [query.offset, query.limit]),
      ).toEqual([
        [0, 1],
        [149, 1],
      ]);
    } finally {
      await app.close();
    }
  });
  it('excludes foreign name matches, religious, unavailable, empty, blocked and explicitly excluded stations', async () => {
    const eligible = station(1);
    const blocked = station(6);
    const excluded = station(7);
    const repository = testRepository(
      prepareSnapshot(
        [
          eligible,
          station(2, 'GB'),
          station(3, 'CN', 'religious'),
          station(4, 'CN', 'jazz', 0),
          { ...station(5), streams: [] },
          blocked,
          excluded,
        ],
        [],
      ),
    );
    vi.mocked(repository.overrides).mockResolvedValue(new Set([blocked.id]));
    const app = buildApp(readEnvironment({}), false, createCatalogService(repository));
    try {
      const result = await app.inject(`/api/v1/stations/random-china?excludeIds=${excluded.id}`);
      expect(result.statusCode).toBe(200);
      expect(result.json().station).toEqual(eligible);
      expect(repository.query).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });
  it('returns null without falling back abroad when no eligible China station exists', async () => {
    const app = buildApp(
      readEnvironment({}),
      false,
      createCatalogService(testRepository(prepareSnapshot([station(1, 'GB')], []))),
    );
    try {
      const result = await app.inject('/api/v1/stations/random-china');
      expect(result.statusCode).toBe(200);
      expect(result.json()).toEqual({ station: null });
    } finally {
      await app.close();
    }
  });
  it('validates exclusions and preserves the unavailable-catalog error', async () => {
    const app = buildApp(readEnvironment({}), false);
    try {
      expect(
        (await app.inject('/api/v1/stations/random-china?excludeIds=invalid')).statusCode,
      ).toBe(400);
      const ids = Array.from({ length: 33 }, (_, i) => station(i + 1).id).join(',');
      expect((await app.inject(`/api/v1/stations/random-china?excludeIds=${ids}`)).statusCode).toBe(
        400,
      );
      expect((await app.inject('/api/v1/stations/random-china')).statusCode).toBe(503);
    } finally {
      await app.close();
    }
  });
});
