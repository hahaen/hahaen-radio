import { afterEach, describe, expect, it, vi } from 'vitest';
import { CatalogSourceError } from '../../integrations/radio-browser.js';
import { normalizeStation } from './normalize.js';
import { synchronizeCatalog } from './sync.js';
import { testRepository } from '../../testing/catalog-repository.js';

const stations = [
  normalizeStation({
    stationuuid: '00000000-0000-4000-8000-000000000001',
    name: 'Fixture',
    url: 'https://radio.example/live',
    lastcheckok: 1,
  })!,
];
afterEach(() => vi.useRealTimers());
describe('catalogue synchronization orchestration', () => {
  it('stages before publishing and releases its lease', async () => {
    const repository = testRepository();
    const result = await synchronizeCatalog(repository, {
      load: async () => ({ stations, sourceCount: 1, invalidCount: 0 }),
    });
    expect(result.status).toBe('published');
    expect(repository.enrich).toHaveBeenCalledWith(stations, expect.any(AbortSignal));
    expect(vi.mocked(repository.stage).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(repository.publish).mock.invocationCallOrder[0]!,
    );
    expect(repository.finish).toHaveBeenCalledWith(expect.any(String), undefined);
  });
  it('does not fetch or publish when a different worker owns the lease', async () => {
    const repository = testRepository();
    vi.mocked(repository.acquire).mockResolvedValue(null);
    const load = vi.fn();
    expect(await synchronizeCatalog(repository, { load })).toEqual({ status: 'busy' });
    expect(load).not.toHaveBeenCalled();
    expect(repository.publish).not.toHaveBeenCalled();
  });
  it('preserves the published head when source or staging fails and records only a safe failure code', async () => {
    for (const staging of [false, true]) {
      const repository = testRepository();
      if (staging)
        vi.mocked(repository.stage).mockRejectedValue(new Error('sensitive driver details'));
      const source = {
        load: async () => {
          if (!staging) throw new CatalogSourceError('CATALOG_SOURCE_UNAVAILABLE');
          return { stations, sourceCount: 1, invalidCount: 0 };
        },
      };
      await expect(synchronizeCatalog(repository, source)).rejects.toThrow(
        staging ? 'CATALOG_SYNC_FAILED' : 'CATALOG_SOURCE_UNAVAILABLE',
      );
      expect(repository.publish).not.toHaveBeenCalled();
      expect(repository.finish).toHaveBeenCalledWith(
        expect.any(String),
        staging ? 'CATALOG_SYNC_FAILED' : 'CATALOG_SOURCE_UNAVAILABLE',
      );
    }
  });
  it('preserves the old catalogue when offline place data cannot be validated', async () => {
    const repository = testRepository();
    vi.mocked(repository.enrich).mockRejectedValue(new Error('CATALOG_PLACES_UNAVAILABLE'));
    await expect(
      synchronizeCatalog(repository, {
        load: async () => ({ stations, sourceCount: 1, invalidCount: 0 }),
      }),
    ).rejects.toThrow('CATALOG_PLACES_UNAVAILABLE');
    expect(repository.stage).not.toHaveBeenCalled();
    expect(repository.publish).not.toHaveBeenCalled();
    expect(repository.finish).toHaveBeenCalledWith(
      expect.any(String),
      'CATALOG_PLACES_UNAVAILABLE',
    );
  });
  it('aborts an in-flight source after losing the heartbeat and never publishes', async () => {
    vi.useFakeTimers();
    const repository = testRepository();
    vi.mocked(repository.renew).mockRejectedValue(new Error('lease lost'));
    const task = synchronizeCatalog(repository, {
      load: (signal) =>
        new Promise((_resolve, reject) => {
          signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
        }),
    });
    const assertion = expect(task).rejects.toThrow('CATALOG_LEASE_LOST');
    await vi.advanceTimersByTimeAsync(30001);
    await assertion;
    expect(repository.publish).not.toHaveBeenCalled();
  });
});
