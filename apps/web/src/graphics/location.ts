import type { StationPreview } from '@haen/contracts';
import countries from './countries.json' with { type: 'json' };
import interiors from './country-interiors.json' with { type: 'json' };
import { coordinatesMatchCountry } from './country-coverage.js';
import { coordinatesMatchRegion, stationRegion } from './regions.js';

export interface MapPosition {
  latitude: number;
  longitude: number;
  precision: 'coordinates' | 'region' | 'country';
  regionId?: string;
  regionName?: string;
  regionNameEn?: string;
}
const countryLabels: Readonly<Record<string, readonly number[]>> = countries;
const countryInteriors: Readonly<Record<string, readonly number[]>> = interiors;
const regionNames = new Map<string, Intl.DisplayNames>();

/** Presentation positions never replace a station's original geographic evidence. */
export function mapPosition(station: StationPreview): MapPosition | null {
  const region = stationRegion(station.countryCode, station.region);
  if (
    station.locationPrecision === 'coordinates' &&
    station.latitude !== null &&
    station.longitude !== null &&
    Number.isFinite(station.latitude) &&
    Math.abs(station.latitude) <= 90 &&
    Number.isFinite(station.longitude) &&
    Math.abs(station.longitude) <= 180 &&
    (!station.countryCode ||
      coordinatesMatchCountry(station.countryCode, station.latitude, station.longitude)) &&
    (!region || coordinatesMatchRegion(region, station.latitude, station.longitude))
  )
    return { latitude: station.latitude, longitude: station.longitude, precision: 'coordinates' };
  if (region)
    return {
      latitude: (region.triangle[1]! + region.triangle[3]! + region.triangle[5]!) / 3,
      longitude: (region.triangle[0]! + region.triangle[2]! + region.triangle[4]!) / 3,
      precision: 'region',
      regionId: region.id,
      regionName: region.name,
      regionNameEn: region.nameEn,
    };
  const point = station.countryCode ? countryLabels[station.countryCode] : undefined;
  const interior = station.countryCode ? countryInteriors[station.countryCode] : undefined;
  if (!point || !interior) return null;
  // Use one inland representative point for the area, independent of station IDs.
  const [scale, ax, ay, bx, by, cx, cy] = interior as readonly [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return {
    latitude: point[0]! + (ay + by + cy) / (3 * scale),
    longitude: point[1]! + (ax + bx + cx) / (3 * scale),
    precision: 'country',
  };
}

export function countryName(code: string | null, language: string): string {
  if (!code) return '';
  if (code === 'TW') return language === 'en' ? 'Taiwan, China' : '中国台湾';
  const locale = language === 'en' ? 'en' : 'zh-CN';
  let names = regionNames.get(locale);
  if (!names) {
    names = new Intl.DisplayNames([locale], { type: 'region' });
    regionNames.set(locale, names);
  }
  return names.of(code) ?? code;
}
