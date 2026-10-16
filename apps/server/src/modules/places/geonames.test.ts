import { describe, expect, it } from 'vitest';
import { normalizeStation } from '../catalog/normalize.js';
import { createPlaceEnricher, distanceKm, parseGeoNames, type Place } from './geonames.js';
const place: Place = {
  id: 1,
  name: '京都市',
  asciiName: 'Kyoto',
  aliases: '京都,Kyoto',
  countryCode: 'JP',
  latitude: 35.011,
  longitude: 135.768,
  timezone: 'Asia/Tokyo',
};
const station = (latitude: number | null, longitude: number | null, countrycode = 'JP') =>
  normalizeStation({
    stationuuid: '00000000-0000-4000-8000-000000000001',
    name: 'Geography fixture',
    countrycode,
    geo_lat: latitude,
    geo_long: longitude,
  })!;
const row = () => [
  '1',
  '京都市',
  'Kyoto',
  '京都,Kyoto',
  '35.011',
  '135.768',
  'P',
  'PPLA',
  'JP',
  '',
  '26',
  '',
  '',
  '',
  '1000000',
  '',
  '',
  'Asia/Tokyo',
  '2026-10-16',
];
describe('offline place evidence', () => {
  it('reads the documented 19-column UTF-8 format and rejects duplicate or malformed records', () => {
    expect(parseGeoNames(row().join('\t'))).toEqual([place]);
    expect(() => parseGeoNames(row().join('\t') + '\n' + row().join('\t'))).toThrow(
      'PLACES_INVALID_RECORD',
    );
    for (const [index, value] of [
      [4, ''],
      [5, '181'],
      [6, 'A'],
      [17, 'not/a-timezone'],
    ] as const) {
      const fields = row();
      fields[index] = value;
      expect(() => parseGeoNames(fields.join('\t'))).toThrow();
    }
  });
  it('never assigns an exact city from proximity and uses time only at a tightly matching place point', () => {
    const enrich = createPlaceEnricher([place]);
    expect(enrich(station(35.011, 135.768))).toMatchObject({
      city: null,
      nearbyCity: '京都市',
      timezone: 'Asia/Tokyo',
      timezoneSource: 'geonames',
    });
    expect(enrich(station(35.04, 135.768))).toMatchObject({
      city: null,
      nearbyCity: '京都市',
      timezone: null,
    });
  });
  it('leaves unknown, country-only, foreign and distant points without invented metadata', () => {
    const enrich = createPlaceEnricher([place]);
    for (const value of [station(null, null), station(0, 0), station(35.011, 135.768, 'US')])
      expect(enrich(value)).toBe(value);
  });
  it('withholds timezone when nearby evidence disagrees', () => {
    const enrich = createPlaceEnricher([
      place,
      { ...place, id: 2, latitude: 35.012, timezone: 'UTC' },
    ]);
    expect(enrich(station(35.011, 135.768))).toMatchObject({
      nearbyCity: '京都市',
      timezone: null,
    });
  });
  it('handles date-line and polar neighbours without a longitude gap', () => {
    const edge = { ...place, countryCode: 'NZ', latitude: 0, longitude: -179.99 };
    expect(createPlaceEnricher([edge])(station(0, 179.99, 'NZ')).nearbyCity).toBe('京都市');
    const pole = { ...place, countryCode: 'NO', latitude: 89.95, longitude: -150 };
    expect(createPlaceEnricher([pole])(station(89.9, 0, 'NO')).nearbyCity).toBe('京都市');
    expect(
      distanceKm({ latitude: 0, longitude: 179.99 }, { latitude: 0, longitude: -179.99 }),
    ).toBeLessThan(3);
  });
});
