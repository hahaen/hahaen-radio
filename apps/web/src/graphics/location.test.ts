import { describe, expect, it } from 'vitest';
import { testStation } from '../testing/stations';
import { mapPosition } from './location';
import { stationPosition } from './markers';
import { coordinatesMatchCountry } from './country-coverage';
import countries from './countries.json';

describe('station geographic evidence', () => {
  it('does not draw a foreign station with conflicting coordinates over China', () => {
    const station = {
      ...testStation(1),
      countryCode: 'US',
      latitude: 39.9,
      longitude: 116.4,
      locationPrecision: 'coordinates' as const,
    };
    expect(mapPosition(station)?.precision).toBe('country');
    const point = stationPosition(station)!;
    expect(point.longitude).toBeLessThan(-60);
    expect(station.longitude).toBe(116.4);
  });

  it.each([
    ['CN', 39.9, 116.4],
    ['US', 40.71, -74.01],
    ['GB', 51.5, -0.1],
    ['CH', 47.56, 7.59],
    ['JP', 35.68, 139.69],
    ['AU', -33.87, 151.21],
    ['BR', -23.55, -46.63],
    ['TW', 25.03, 121.56],
    ['HK', 22.28, 114.16],
    ['US', 21.31, -157.86],
    ['US', 61.22, -149.9],
    ['FJ', -16.8, -179.9],
    ['SG', 1.35, 103.82],
    ['MC', 43.74, 7.43],
  ])('preserves valid coordinates and border/island locations for %s', (code, lat, lon) => {
    const station = {
      ...testStation(1),
      countryCode: String(code),
      latitude: Number(lat),
      longitude: Number(lon),
      locationPrecision: 'coordinates' as const,
    };
    expect(mapPosition(station)).toEqual({
      latitude: lat,
      longitude: lon,
      precision: 'coordinates',
    });
    expect(stationPosition(station)).toEqual(mapPosition(station));
  });

  it.each(['US', 'GB', 'DE', 'JP', 'AU', 'BR'])(
    'rejects Beijing coordinates declared as %s',
    (code) => {
      expect(coordinatesMatchCountry(code, 39.9, 116.4)).toBe(false);
    },
  );

  it('keeps country-only display points in their own coverage for every supported country', () => {
    for (const code of Object.keys(countries))
      for (let i = 1; i <= 100; i++) {
        const point = stationPosition({ ...testStation(i), countryCode: code })!;
        expect(point.precision).toBe('country');
        expect(coordinatesMatchCountry(code, point.latitude, point.longitude), code).toBe(true);
      }
  });

  it.each([
    [null, 116],
    [NaN, 116],
    [91, 116],
    [39, Infinity],
    [39, 181],
    [0, 0],
  ])('falls back to the declared country for unusable coordinates %s,%s', (lat, lon) => {
    expect(
      mapPosition({
        ...testStation(1),
        countryCode: 'CN',
        latitude: lat,
        longitude: lon,
        locationPrecision: 'coordinates',
      })?.precision,
    ).toBe('country');
  });

  it('retains valid coordinates without a country and excludes positions without geographic evidence', () => {
    expect(
      mapPosition({
        ...testStation(1),
        countryCode: null,
        latitude: 0,
        longitude: 0,
        locationPrecision: 'coordinates',
      }),
    ).toEqual({ latitude: 0, longitude: 0, precision: 'coordinates' });
    expect(mapPosition({ ...testStation(1), countryCode: null })).toBeNull();
  });
});
