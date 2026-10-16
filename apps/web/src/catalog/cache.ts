import { openDB } from 'idb';
import { z } from 'zod';
import {
  MAX_SCENE_STATIONS,
  SceneEntrySchema,
  SceneManifestSchema,
  type SceneEntry,
  type SceneManifest,
} from '@haen/contracts';

export interface CatalogRecord {
  key: string;
  savedAt: number;
  manifest: SceneManifest;
  entries: SceneEntry[];
}
export interface CatalogCache {
  get(key: string): Promise<unknown>;
  latest(): Promise<unknown[]>;
  put(record: CatalogRecord): Promise<void>;
}
export const catalogKey = (manifest: SceneManifest) =>
  `${manifest.version}:${manifest.restrictionsRevision}`;
const RecordSchema = z.object({
  key: z.string().max(101),
  savedAt: z.number().int().nonnegative(),
  manifest: SceneManifestSchema,
  entries: z.array(SceneEntrySchema).max(MAX_SCENE_STATIONS),
});
export function validateCatalogRecord(input: unknown): CatalogRecord {
  if (
    typeof input === 'object' &&
    input !== null &&
    'entries' in input &&
    Array.isArray(input.entries) &&
    input.entries.length > MAX_SCENE_STATIONS
  )
    throw new Error('INVALID_CATALOG_CACHE');
  const record = RecordSchema.parse(input);
  if (
    record.key !== catalogKey(record.manifest) ||
    record.entries.length !== record.manifest.stationCount ||
    new Set(record.entries.map((entry) => entry[0])).size !== record.entries.length ||
    record.savedAt > Date.now() + 60000
  )
    throw new Error('INVALID_CATALOG_CACHE');
  return record;
}
async function withDatabase<T>(
  operation: (db: Awaited<ReturnType<typeof openDB>>) => Promise<T>,
): Promise<T> {
  let expired = false;
  let current: Awaited<ReturnType<typeof openDB>> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const opening = openDB('haen-catalog', 1, {
    upgrade(db) {
      const store = db.createObjectStore('snapshots', { keyPath: 'key' });
      store.createIndex('savedAt', 'savedAt');
    },
    blocking() {
      current?.close();
    },
  }).then((db) => {
    if (expired) {
      db.close();
      throw new Error('CACHE_TIMEOUT');
    }
    current = db;
    return operation(db);
  });
  try {
    return await Promise.race([
      opening,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('CACHE_TIMEOUT')), 2000);
      }),
    ]);
  } finally {
    expired = true;
    if (timer) clearTimeout(timer);
    current?.close();
  }
}
export const browserCatalogCache: CatalogCache = {
  get: (key) => withDatabase((db) => db.get('snapshots', key)),
  latest: () =>
    withDatabase(async (db) => {
      const tx = db.transaction('snapshots', 'readonly');
      let cursor = await tx.store.index('savedAt').openCursor(null, 'prev');
      const result: unknown[] = [];
      while (cursor && result.length < 2) {
        result.push(cursor.value);
        cursor = await cursor.continue();
      }
      await tx.done;
      return result;
    }),
  put: (record) =>
    withDatabase(async (db) => {
      const tx = db.transaction('snapshots', 'readwrite');
      await tx.store.put(record);
      let count = await tx.store.count();
      if (count > 10) {
        await tx.store.clear();
        await tx.store.put(record);
      } else
        while (count > 2) {
          const cursor = await tx.store.index('savedAt').openCursor();
          if (!cursor) break;
          await cursor.delete();
          count--;
        }
      await tx.done;
    }),
};
