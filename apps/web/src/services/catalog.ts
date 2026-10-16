import {
  CatalogManifestSchema,
  StationDetailSchema,
  StationPageSchema,
  StationLookupResultSchema,
  type StationSummary,
  type StationDetail,
} from '@haen/contracts';
import { getJson } from './http';

export interface SearchFilters {
  q: string;
  genres?: string[];
  languages?: string[];
  minBitrate?: 0 | 128 | 192 | 320;
}
export function searchStations(
  filters: SearchFilters,
  offset = 0,
  limit = 30,
  signal?: AbortSignal,
  excludeIds: readonly string[] = [],
) {
  const parameters = new URLSearchParams({
    q: filters.q,
    offset: String(offset),
    limit: String(limit),
    playableOnly: 'true',
  });
  if (filters.genres) parameters.set('genres', filters.genres.join(','));
  if (filters.languages) parameters.set('languages', filters.languages.join(','));
  if (filters.minBitrate) parameters.set('minBitrate', String(filters.minBitrate));
  if (excludeIds.length) parameters.set('excludeIds', [...new Set(excludeIds)].join(','));
  return getJson(`/stations?${parameters}`, StationPageSchema, signal);
}
export const getCatalog = (signal?: AbortSignal) =>
  getJson('/catalog', CatalogManifestSchema, signal);
export const getStation = (id: string, signal?: AbortSignal) =>
  getJson(`/stations/${encodeURIComponent(id)}`, StationDetailSchema, signal);
export async function lookupStations(ids: readonly string[], signal: AbortSignal) {
  const items: StationDetail[] = [],
    missing: string[] = [];
  const unique = [...new Set(ids)];
  if (unique.length > 25000) throw new Error('LIBRARY_CAPACITY');
  const controller = new AbortController();
  const active = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(90000)]);
  let next = 0;
  const worker = async () => {
    while (next < unique.length) {
      active.throwIfAborted();
      const offset = next;
      next += 100;
      const batch = unique.slice(offset, offset + 100);
      const result = await getJson('/stations/lookup', StationLookupResultSchema, active, {
        method: 'POST',
        body: { ids: batch },
      });
      const returned = [...result.items.map((item) => item.id), ...result.missing];
      if (
        returned.length !== batch.length ||
        new Set(returned).size !== batch.length ||
        returned.some((id) => !batch.includes(id))
      )
        throw new Error('INVALID_LOOKUP_RESULT');
      items.push(...result.items);
      missing.push(...result.missing);
    }
  };
  const workers = Array.from({ length: Math.min(2, Math.ceil(unique.length / 100)) }, worker);
  try {
    await Promise.all(workers);
  } catch (error) {
    controller.abort();
    await Promise.allSettled(workers);
    throw error;
  }
  active.throwIfAborted();
  return { items, missing };
}
export async function randomStation(
  filters: SearchFilters,
  signal: AbortSignal,
  excluded: string | readonly string[] = [],
): Promise<StationSummary | null> {
  const excludeIds = typeof excluded === 'string' ? [excluded] : excluded;
  const pool = await searchStations(filters, 0, 1, signal, excludeIds);
  if (!pool.total) return null;
  const offset = Math.floor(Math.random() * pool.total);
  const selected =
    offset === 0
      ? pool.items[0]
      : (await searchStations(filters, offset, 1, signal, excludeIds)).items[0];
  return selected && !excludeIds.includes(selected.id) ? selected : null;
}
