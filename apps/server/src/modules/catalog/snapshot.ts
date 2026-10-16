import { randomUUID } from 'node:crypto';
import {
  CatalogManifestSchema,
  GenreSchema,
  StationDetailSchema,
  StationSummarySchema,
  type CatalogManifest,
  type StationDetail,
  type StationSummary,
} from '@haen/contracts';

export const CATALOG_CHUNK_SIZE = 1000;
export interface RegistryEntry {
  payload: StationDetail;
  missingCount: number;
}
export interface SnapshotEntry {
  station: StationDetail;
  observed: boolean;
}
export interface CatalogSnapshot {
  manifest: CatalogManifest;
  entries: SnapshotEntry[];
}
export function summaryOf(station: StationDetail): StationSummary {
  return StationSummarySchema.parse(station);
}
export function prepareSnapshot(
  incoming: StationDetail[],
  registry: RegistryEntry[],
  now = new Date(),
): CatalogSnapshot {
  if (!incoming.length || incoming.length > 150000) throw new Error('CATALOG_INVALID_SIZE');
  const incomingIds = new Set<string>();
  const entries: SnapshotEntry[] = incoming.map((value) => {
    const station = StationDetailSchema.parse(value);
    if (incomingIds.has(station.id)) throw new Error('CATALOG_DUPLICATE_ID');
    incomingIds.add(station.id);
    return { station, observed: true };
  });
  const previousPresent = registry.filter((entry) => entry.missingCount === 0).length;
  if (previousPresent >= 1000 && incoming.length < previousPresent * 0.7)
    throw new Error('CATALOG_SUSPICIOUS_SHRINK');
  for (const previous of registry) {
    if (incomingIds.has(previous.payload.id)) continue;
    entries.push({
      observed: false,
      station: {
        ...previous.payload,
        availability:
          previous.missingCount + 1 >= 3 ? 'unavailable' : previous.payload.availability,
      },
    });
  }
  if (entries.length > 200000) throw new Error('CATALOG_REGISTRY_LIMIT');
  entries.sort((a, b) => a.station.id.localeCompare(b.station.id));
  const genres = new Map<string, number>();
  const languages = new Map<string, number>();
  const countries = new Set<string>();
  let playableCount = 0;
  for (const { station } of entries) {
    genres.set(station.genre, (genres.get(station.genre) ?? 0) + 1);
    for (const language of station.languages)
      languages.set(language, (languages.get(language) ?? 0) + 1);
    if (station.countryCode) countries.add(station.countryCode);
    if (station.availability === 'available' && station.streams.length) playableCount++;
  }
  const manifest = CatalogManifestSchema.parse({
    version: randomUUID(),
    createdAt: now.toISOString(),
    stationCount: entries.length,
    playableCount,
    countryCount: countries.size,
    genres: GenreSchema.options.map((id) => ({ id, count: genres.get(id) ?? 0 })),
    languages: [...languages]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, count]) => ({ id, count })),
    chunks: Array.from({ length: Math.ceil(entries.length / CATALOG_CHUNK_SIZE) }, (_, index) => ({
      index,
      count: Math.min(CATALOG_CHUNK_SIZE, entries.length - index * CATALOG_CHUNK_SIZE),
    })),
  });
  return { manifest, entries };
}
