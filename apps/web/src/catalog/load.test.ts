import { describe, expect, it, vi } from 'vitest';
import { encodeSceneEntry, type SceneManifest, type SceneChunk } from '@haen/contracts';
import { testStation } from '../testing/stations';
import { catalogKey, type CatalogCache, type CatalogRecord } from './cache';
import { loadSceneCatalog } from './load';
import { HttpError } from '../services/http';
const stations = [testStation(1), testStation(2)];
const manifest: SceneManifest = {
  format: 1,
  version: '90000000-0000-4000-8000-000000000001',
  restrictionsRevision: 'a'.repeat(64),
  createdAt: new Date(0).toISOString(),
  stationCount: 2,
  playableCount: 2,
  countryCount: 1,
  genres: [],
  languages: [],
  chunks: [
    { index: 0, count: 1 },
    { index: 1, count: 1 },
  ],
};
const record: CatalogRecord = {
  key: catalogKey(manifest),
  manifest,
  entries: stations.map(encodeSceneEntry),
  savedAt: Date.now(),
};
function harness() {
  const cache: CatalogCache = {
    get: vi.fn(async () => undefined),
    latest: vi.fn(async () => []),
    put: vi.fn(async () => {}),
  };
  const getManifest = vi.fn(async () => manifest);
  const chunk = vi.fn(async (_version: string, index: number): Promise<SceneChunk> => ({
    format: 1,
    version: manifest.version,
    index,
    restrictionsRevision: manifest.restrictionsRevision,
    entries: [encodeSceneEntry(stations[index]!)],
  }));
  return { cache, manifest: getManifest, chunk };
}
describe('complete versioned scene catalogue', () => {
  it('refreshes once when an old catalogue version disappears during download', async () => {
    const dependencies = harness();
    const next = { ...manifest, version: '90000000-0000-4000-8000-000000000002' };
    dependencies.manifest.mockResolvedValueOnce(manifest).mockResolvedValue(next);
    dependencies.chunk
      .mockRejectedValueOnce(new HttpError(404, 'NOT_FOUND'))
      .mockImplementation(async (version, index) => ({
        format: 1,
        version,
        index,
        restrictionsRevision: manifest.restrictionsRevision,
        entries: [encodeSceneEntry(stations[index]!)],
      }));
    const result = await loadSceneCatalog(new AbortController().signal, undefined, dependencies);
    expect(result.manifest.version).toBe(next.version);
    expect(dependencies.manifest).toHaveBeenCalledTimes(2);
    expect(dependencies.cache.put).toHaveBeenCalledOnce();
  });
  it('downloads all chunks, reports complete progress and caches only a valid full snapshot', async () => {
    const dependencies = harness(),
      progress = vi.fn();
    const result = await loadSceneCatalog(new AbortController().signal, progress, dependencies);
    expect(result.stations.map((station) => station.id)).toEqual(
      stations.map((station) => station.id),
    );
    expect(result.stations[0]).not.toHaveProperty('streams');
    expect(progress).toHaveBeenLastCalledWith(2, 2);
    expect(dependencies.cache.put).toHaveBeenCalledWith(
      expect.objectContaining({ key: record.key, entries: record.entries }),
    );
  });
  it('reuses a valid exact-version cache without reloading all chunks', async () => {
    const dependencies = harness();
    vi.mocked(dependencies.cache.get).mockResolvedValue(record);
    expect(
      (await loadSceneCatalog(new AbortController().signal, undefined, dependencies)).stale,
    ).toBe(false);
    expect(dependencies.chunk).not.toHaveBeenCalled();
  });
  it('rejects a cache belonging to a different version even if its own contents are valid', async () => {
    const dependencies = harness();
    const older = { ...manifest, version: '90000000-0000-4000-8000-000000000002' };
    vi.mocked(dependencies.cache.get).mockResolvedValue({
      ...record,
      key: catalogKey(older),
      manifest: older,
    });
    await loadSceneCatalog(new AbortController().signal, undefined, dependencies);
    expect(dependencies.chunk).toHaveBeenCalledTimes(2);
  });
  it('finishes without persistent cache when storage is denied or full', async () => {
    const dependencies = harness();
    vi.mocked(dependencies.cache.get).mockRejectedValue(new Error('denied'));
    vi.mocked(dependencies.cache.put).mockRejectedValue(new Error('quota'));
    expect(
      (await loadSceneCatalog(new AbortController().signal, undefined, dependencies)).stations,
    ).toHaveLength(2);
  });
  it('discards mixed restriction revisions and refreshes once before exposing a scene', async () => {
    const dependencies = harness();
    let requests = 0;
    dependencies.chunk.mockImplementation(async (_version, index) => ({
      format: 1,
      version: manifest.version,
      index,
      restrictionsRevision: ++requests === 1 ? 'b'.repeat(64) : manifest.restrictionsRevision,
      entries: [encodeSceneEntry(stations[index]!)],
    }));
    expect(
      (await loadSceneCatalog(new AbortController().signal, undefined, dependencies)).stale,
    ).toBe(false);
    expect(dependencies.manifest).toHaveBeenCalledTimes(2);
    expect(dependencies.cache.put).toHaveBeenCalledOnce();
  });
  it('never caches a partial or duplicate-ID index', async () => {
    const dependencies = harness();
    dependencies.chunk.mockImplementation(async (_version, index) => ({
      format: 1,
      version: manifest.version,
      index,
      restrictionsRevision: manifest.restrictionsRevision,
      entries: [encodeSceneEntry(stations[0]!)],
    }));
    await expect(
      loadSceneCatalog(new AbortController().signal, undefined, dependencies),
    ).rejects.toThrow('INCOMPLETE_SCENE_CATALOG');
    expect(dependencies.cache.put).not.toHaveBeenCalled();
  });
  it('uses a complete older snapshot when the network fails and marks it as stale', async () => {
    const dependencies = harness();
    dependencies.manifest.mockRejectedValue(new Error('offline'));
    vi.mocked(dependencies.cache.latest).mockResolvedValue([{ bad: true }, record]);
    expect(
      (await loadSceneCatalog(new AbortController().signal, undefined, dependencies)).stale,
    ).toBe(true);
  });
  it('does not turn explicit cancellation into a stale cached result', async () => {
    const dependencies = harness(),
      controller = new AbortController();
    dependencies.manifest.mockImplementation(async () => {
      controller.abort();
      throw new Error('cancelled');
    });
    vi.mocked(dependencies.cache.latest).mockResolvedValue([record]);
    await expect(loadSceneCatalog(controller.signal, undefined, dependencies)).rejects.toThrow();
    expect(dependencies.cache.latest).not.toHaveBeenCalled();
  });
});
