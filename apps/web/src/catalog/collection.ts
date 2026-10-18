import { countrySearchText, type StationPreview } from '@haen/contracts';
import type { SearchFilters } from '../services/catalog';
const fold = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
export function createStationCollection(stations: readonly StationPreview[]) {
  const indexed = stations.map((station) => ({
    station,
    text: fold(
      [
        station.name,
        station.region,
        station.city,
        station.nearbyCity,
        countrySearchText(station.countryCode),
      ].join(' '),
    ),
  }));
  return {
    filter(filters: SearchFilters): StationPreview[] {
      const terms = fold(filters.q.trim()).split(/\s+/).filter(Boolean);
      return indexed
        .filter(
          ({ station, text }) =>
            station.availability === 'available' &&
            terms.every((term) => text.includes(term)) &&
            (filters.genres === undefined || filters.genres.includes(station.genre)) &&
            (filters.languages === undefined ||
              station.languages.some((language) => filters.languages!.includes(language))) &&
            (!filters.minBitrate ||
              (station.bitrate !== null && station.bitrate >= filters.minBitrate)),
        )
        .map((item) => item.station);
    },
  };
}
export function pickStation(
  stations: readonly StationPreview[],
  excluded: readonly string[] = [],
): StationPreview | null {
  const unavailable = new Set(excluded);
  const candidates = stations.filter((station) => !unavailable.has(station.id));
  return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
}
