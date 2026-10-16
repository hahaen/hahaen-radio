import type { StationPreview } from '@haen/contracts';
import type { SearchFilters } from '../services/catalog';
const fold = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const countryTerms = new Map<string, string>();
const countryNames = [
  new Intl.DisplayNames(['en'], { type: 'region' }),
  new Intl.DisplayNames(['zh-CN'], { type: 'region' }),
];
function countryText(code: string | null) {
  if (!code) return '';
  if (!countryTerms.has(code))
    countryTerms.set(code, fold([code, ...countryNames.map((names) => names.of(code))].join(' ')));
  return countryTerms.get(code)!;
}
export function createStationCollection(stations: readonly StationPreview[]) {
  const indexed = stations.map((station) => ({
    station,
    text: fold(
      [
        station.name,
        station.region,
        station.city,
        station.nearbyCity,
        countryText(station.countryCode),
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
