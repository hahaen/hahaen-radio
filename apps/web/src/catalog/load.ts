import {
  MAX_SCENE_STATIONS,
  SceneChunkSchema,
  SceneManifestSchema,
  decodeSceneEntry,
  type SceneChunk,
  type SceneEntry,
  type SceneManifest,
  type StationPreview,
} from '@haen/contracts';
import { getJson, HttpError } from '../services/http';
import {
  browserCatalogCache,
  catalogKey,
  validateCatalogRecord,
  type CatalogCache,
  type CatalogRecord,
} from './cache';
export interface SceneCatalog {
  manifest: SceneManifest;
  stations: StationPreview[];
  stale: boolean;
}
class CatalogChangedError extends Error {}
interface Dependencies {
  cache: CatalogCache;
  manifest(signal: AbortSignal): Promise<SceneManifest>;
  chunk(version: string, index: number, signal: AbortSignal): Promise<SceneChunk>;
}
const defaults: Dependencies = {
  cache: browserCatalogCache,
  manifest: (signal) => getJson('/catalog/scene', SceneManifestSchema, signal),
  chunk: (version, index, signal) =>
    getJson(`/catalog/scene/${version}/chunks/${index}`, SceneChunkSchema, signal),
};
const view = (record: CatalogRecord, stale: boolean): SceneCatalog => ({
  manifest: record.manifest,
  stations: record.entries.map(decodeSceneEntry),
  stale,
});
function checkManifest(manifest: SceneManifest) {
  if (
    manifest.stationCount > MAX_SCENE_STATIONS ||
    manifest.chunks.length > MAX_SCENE_STATIONS / 1000 ||
    manifest.chunks.some(
      (chunk, index) => chunk.index !== index || chunk.count < 1 || chunk.count > 1000,
    ) ||
    manifest.chunks.reduce((sum, chunk) => sum + chunk.count, 0) !== manifest.stationCount
  )
    throw new Error('INVALID_SCENE_MANIFEST');
}
export async function loadSceneCatalog(
  signal: AbortSignal,
  onProgress: (loaded: number, total: number) => void = () => {},
  overrides: Partial<Dependencies> = {},
): Promise<SceneCatalog> {
  const dependencies = { ...defaults, ...overrides };
  const deadline = AbortSignal.timeout(90000);
  const active = AbortSignal.any([signal, deadline]);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      active.throwIfAborted();
      const manifest = SceneManifestSchema.parse(await dependencies.manifest(active));
      checkManifest(manifest);
      const key = catalogKey(manifest);
      try {
        const cached = validateCatalogRecord(await dependencies.cache.get(key));
        if (cached.key !== key) throw new Error('INVALID_CATALOG_CACHE');
        active.throwIfAborted();
        onProgress(manifest.stationCount, manifest.stationCount);
        return view({ ...cached, manifest }, false);
      } catch {
        active.throwIfAborted();
      }
      const controller = new AbortController();
      const fetching = AbortSignal.any([active, controller.signal]);
      const chunks: SceneEntry[][] = new Array<SceneEntry[]>(manifest.chunks.length);
      let next = 0,
        loaded = 0;
      onProgress(0, manifest.stationCount);
      const worker = async () => {
        while (next < manifest.chunks.length) {
          fetching.throwIfAborted();
          const index = next++;
          const chunk = SceneChunkSchema.parse(
            await dependencies.chunk(manifest.version, index, fetching).catch((error) => {
              if (error instanceof HttpError && error.status === 404)
                throw new CatalogChangedError();
              throw error;
            }),
          );
          fetching.throwIfAborted();
          if (
            chunk.version !== manifest.version ||
            chunk.index !== index ||
            chunk.restrictionsRevision !== manifest.restrictionsRevision
          )
            throw new CatalogChangedError();
          if (chunk.entries.length !== manifest.chunks[index]!.count)
            throw new Error('INVALID_SCENE_CHUNK');
          chunks[index] = chunk.entries;
          loaded += chunk.entries.length;
          onProgress(loaded, manifest.stationCount);
        }
      };
      const workers = Array.from({ length: Math.min(4, manifest.chunks.length) }, worker);
      try {
        await Promise.all(workers);
      } catch (error) {
        controller.abort();
        await Promise.allSettled(workers);
        if (error instanceof CatalogChangedError && attempt === 0) continue;
        throw error;
      }
      active.throwIfAborted();
      const entries = chunks.flat();
      if (
        entries.length !== manifest.stationCount ||
        new Set(entries.map((entry) => entry[0])).size !== entries.length
      )
        throw new Error('INCOMPLETE_SCENE_CATALOG');
      const record: CatalogRecord = { key, manifest, entries, savedAt: Date.now() };
      await dependencies.cache.put(record).catch(() => {});
      active.throwIfAborted();
      return view(record, false);
    }
    throw new Error('CATALOG_CHANGED');
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    const records = await dependencies.cache.latest().catch(() => []);
    signal.throwIfAborted();
    for (const item of records) {
      try {
        const record = validateCatalogRecord(item);
        checkManifest(record.manifest);
        return view(record, true);
      } catch {
        /* Try the previous complete snapshot. */
      }
    }
    throw error;
  }
}
