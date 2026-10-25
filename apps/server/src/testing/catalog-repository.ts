import { vi } from 'vitest';
import type { StationDetail } from '@haen/contracts';
import type { CatalogRepository } from '../modules/catalog/repository.js';
import type { CatalogSnapshot } from '../modules/catalog/snapshot.js';

// Test fixture only: persistence and transaction correctness require the MySQL suite.
export function testRepository(snapshot?: CatalogSnapshot): CatalogRepository {
  const overrides = vi.fn(async () => new Set<string>());
  return {
    enrich: vi.fn(async (stations: StationDetail[]) => stations),
    acquire: vi.fn(async () => '00000000-0000-4000-8000-000000000099'),
    renew: vi.fn(async () => {}),
    cleanup: vi.fn(async () => {}),
    registry: vi.fn(async () => []),
    stage: vi.fn(async () => {}),
    publish: vi.fn(async () => {}),
    finish: vi.fn(async () => {}),
    currentVersion: vi.fn(async () => snapshot?.manifest.version ?? null),
    manifest: vi.fn(async function (this: CatalogRepository) {
      if (!snapshot) return null;
      const blocked = await this.overrides();
      return {
        ...snapshot.manifest,
        playableCount: snapshot.entries.filter(
          ({ station }) =>
            !blocked.has(station.id) &&
            station.availability === 'available' &&
            station.streams.length > 0,
        ).length,
      };
    }),
    read: vi.fn(async (version: string) =>
      snapshot?.manifest.version === version ? snapshot : null,
    ),
    sceneChunk: vi.fn(async (version, index) =>
      snapshot && snapshot.manifest.version === version
        ? snapshot.entries.slice(index * 1000, (index + 1) * 1000).map(({ station }) => station)
        : [],
    ),
    hasVersion: vi.fn(async (version: string) => snapshot?.manifest.version === version),
    query: vi.fn(async (input) => {
      const blocked = input.search?.playableOnly ? await overrides() : new Set<string>();
      const fold = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
      const matches =
        snapshot && snapshot.manifest.version === input.version
          ? snapshot.entries
              .map((entry) => entry.station)
              .filter((station) => {
                if (input.ids && !input.ids.includes(station.id)) return false;
                if (
                  input.sameCity &&
                  (station.city !== input.sameCity.city ||
                    station.countryCode !== input.sameCity.countryCode)
                )
                  return false;
                if (input.countryCode && station.countryCode !== input.countryCode) return false;
                const query = input.search;
                if (!query) return true;
                if (query.excludeIds.includes(station.id)) return false;
                if (
                  query.playableOnly &&
                  (station.availability !== 'available' ||
                    !station.streams.length ||
                    blocked.has(station.id))
                )
                  return false;
                return (
                  fold(query.q)
                    .split(/\s+/)
                    .filter(Boolean)
                    .every((term) =>
                      fold(
                        [
                          station.name,
                          station.region,
                          station.city,
                          station.nearbyCity,
                          station.countryCode,
                        ].join(' '),
                      ).includes(term),
                    ) &&
                  (query.genres === undefined || query.genres.includes(station.genre)) &&
                  (query.languages === undefined ||
                    station.languages.some((language) => query.languages!.includes(language))) &&
                  (query.minBitrate === 0 ||
                    (station.bitrate !== null && station.bitrate >= query.minBitrate))
                );
              })
          : [];
      return {
        total: matches.length,
        items: matches.slice(input.offset, input.offset + input.limit),
      };
    }),
    overrides,
    setBlocked: vi.fn(async () => {}),
  };
}
