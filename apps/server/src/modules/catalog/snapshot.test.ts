import { describe, expect, it } from 'vitest';
import { normalizeStation } from './normalize.js';
import { prepareSnapshot } from './snapshot.js';

const station = (index: number) =>
  normalizeStation({
    stationuuid: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    name: `Station ${index}`,
    url: 'https://radio.example/live',
    lastcheckok: 1,
    countrycode: 'GB',
    tags: 'jazz',
    languagecodes: 'en',
  })!;
describe('catalogue snapshot publication data', () => {
  it('keeps missing records and marks them unavailable only after three complete observations', () => {
    const previous = station(1);
    const first = prepareSnapshot([station(2)], [{ payload: previous, missingCount: 0 }]);
    expect(first.entries.find((entry) => entry.station.id === previous.id)).toMatchObject({
      observed: false,
      station: { availability: 'available' },
    });
    const third = prepareSnapshot([station(2)], [{ payload: previous, missingCount: 2 }]);
    expect(
      third.entries.find((entry) => entry.station.id === previous.id)?.station.availability,
    ).toBe('unavailable');
    expect(third.manifest).toMatchObject({ stationCount: 2, playableCount: 1, countryCount: 1 });
  });
  it('rejects suspicious shrinkage and duplicate identities rather than publishing a partial source', () => {
    expect(() => prepareSnapshot([station(1), station(1)], [])).toThrow('CATALOG_DUPLICATE_ID');
    const registry = Array.from({ length: 1000 }, (_, index) => ({
      payload: station(index),
      missingCount: 0,
    }));
    expect(() => prepareSnapshot([station(1)], registry)).toThrow('CATALOG_SUSPICIOUS_SHRINK');
    expect(() => prepareSnapshot([], registry)).toThrow('CATALOG_INVALID_SIZE');
  });
  it('provides stable sorted chunks and real counts for a large catalogue', () => {
    const snapshot = prepareSnapshot(
      Array.from({ length: 30000 }, (_, index) => station(index)),
      [],
    );
    expect(snapshot.manifest.stationCount).toBe(30000);
    expect(snapshot.manifest.chunks).toHaveLength(30);
    expect(snapshot.manifest.chunks.every((chunk) => chunk.count === 1000)).toBe(true);
    expect(snapshot.manifest.genres.find((genre) => genre.id === 'jazz')?.count).toBe(30000);
  });
});
