import {
  CatalogManifestSchema,
  StationDetailSchema,
  StationPageSchema,
  type StationSummary,
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
