import type { StationPreview } from '@haen/contracts';
import countries from './countries.json' with { type: 'json' };

export interface MapPosition {
  latitude: number;
  longitude: number;
  precision: 'coordinates' | 'country';
}
const countryLabels: Readonly<Record<string, readonly number[]>> = countries;

/** Presentation positions never replace a station's original geographic evidence. */
export function mapPosition(station: StationPreview): MapPosition | null {
  if (
    station.locationPrecision === 'coordinates' &&
    station.latitude !== null &&
    station.longitude !== null
  )
    return { latitude: station.latitude, longitude: station.longitude, precision: 'coordinates' };
  const point = station.countryCode ? countryLabels[station.countryCode] : undefined;
  return point ? { latitude: point[0]!, longitude: point[1]!, precision: 'country' } : null;
}

export function countryName(code: string | null, language: string): string {
  return code
    ? (new Intl.DisplayNames([language === 'en' ? 'en' : 'zh-CN'], { type: 'region' }).of(code) ??
        code)
    : '';
}
