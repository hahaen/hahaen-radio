import { beforeAll, describe, expect, it } from 'vitest';
import data from '../../public/geography/regions.json';
import { loadRegions, stationRegion, coordinatesMatchRegion } from './regions';
import { testStation } from '../testing/stations';
import { stationPosition } from './markers';
import { groupStations } from './model';
import { mapPosition } from './location';

beforeAll(async () => {
  await loadRegions(new AbortController().signal, async () => new Response(JSON.stringify(data)));
});

describe('province/state positions', () => {
  it.each([
    ['台湾省', 'TW', 25.03, 121.56],
    ['香港特别行政区', 'HK', 22.28, 114.16],
    ['澳门特别行政区', 'MO', 22.2, 113.55],
  ])(
    'resolves explicit China region %s without relocating it to the mainland',
    (name, code, lat, lon) => {
      const region = stationRegion('CN', String(name))!;
      expect(region).not.toBeNull();
      const point = stationPosition({
        ...testStation(1),
        countryCode: 'CN',
        region: String(name),
      })!;
      expect(coordinatesMatchRegion(region, point.latitude, point.longitude)).toBe(true);
      expect(coordinatesMatchRegion(region, Number(lat), Number(lon))).toBe(true);
      expect(
        mapPosition({
          ...testStation(1),
          countryCode: 'CN',
          region: String(name),
          latitude: Number(lat),
          longitude: Number(lon),
          locationPrecision: 'coordinates',
        })?.precision,
      ).toBe('coordinates');
      expect(code).toMatch(/^(TW|HK|MO)$/);
    },
  );
  it('checks stable display samples in every supported administrative region', () => {
    const catalog = data as unknown as Record<string, [string, string[], number[], number[]][]>;
    let checked = 0;
    for (const [code, entries] of Object.entries(catalog))
      for (const [id, aliases] of entries) {
        const alias = aliases.find((value) => stationRegion(code, value)?.id === id);
        expect(
          alias,
          `${code}/${id}: ${JSON.stringify(aliases.map((value) => [value, stationRegion(code, value)?.id]))}`,
        ).toBeDefined();
        const region = stationRegion(code, alias!)!;
        for (let i = 1; i <= 20; i++) {
          const station = { ...testStation(i), countryCode: code, region: alias! };
          const point = stationPosition(station)!;
          expect(point.precision).toBe('region');
          expect(
            coordinatesMatchRegion(region, point.latitude, point.longitude),
            `${code}/${id}`,
          ).toBe(true);
          expect(stationPosition(station)).toEqual(point);
          checked++;
        }
      }
    expect(checked).toBe(4584 * 20);
  }, 15000);
  it.each(['广东', '广东省', '廣東', 'Guangdong', 'Guǎngdōng', 'CN-GD', '广东省广州市'])(
    'matches %s inside China',
    (value) => {
      const region = stationRegion('CN', value)!;
      expect(region).not.toBeNull();
      expect(coordinatesMatchRegion(region, 23.13, 113.26)).toBe(true);
      expect(coordinatesMatchRegion(region, 39.9, 116.4)).toBe(false);
    },
  );

  it.each([
    ['CN', '北京市', 39.9, 116.4],
    ['CN', '上海市', 31.23, 121.47],
    ['CN', '四川省', 30.66, 104.06],
    ['CN', '新疆维吾尔自治区', 43.83, 87.62],
    ['CN', '陕西省', 34.26, 108.94],
    ['CN', '山西省', 37.87, 112.55],
    ['US', 'New York', 40.71, -74.01],
    ['US', 'California', 34.05, -118.24],
    ['AU', 'New South Wales', -33.87, 151.21],
    ['DE', 'Bayern', 48.14, 11.58],
  ])('preserves valid source coordinates in %s/%s', (countryCode, region, latitude, longitude) => {
    expect(
      mapPosition({
        ...testStation(1),
        countryCode: String(countryCode),
        region: String(region),
        latitude: Number(latitude),
        longitude: Number(longitude),
        locationPrecision: 'coordinates',
      }),
    ).toMatchObject({ precision: 'coordinates', latitude, longitude });
  });

  it('places country-only stations in their known provinces without inventing source coordinates', () => {
    const stations = ['广东省', '四川省', '北京市', '上海市'].flatMap((region, r) =>
      Array.from({ length: 100 }, (_, i) => ({
        ...testStation(r * 100 + i + 1),
        countryCode: 'CN',
        region,
      })),
    );
    const before = structuredClone(stations);
    for (const station of stations) {
      const point = stationPosition(station)!;
      expect(point.precision).toBe('region');
      expect(
        coordinatesMatchRegion(
          stationRegion('CN', station.region)!,
          point.latitude,
          point.longitude,
        ),
      ).toBe(true);
    }
    expect(groupStations(stations)).toHaveLength(4);
    expect(stations).toEqual(before);
  });

  it('rejects a Beijing coordinate attached to Guangdong and keeps its marker in Guangdong', () => {
    const station = {
      ...testStation(1),
      countryCode: 'CN',
      region: '广东省',
      locationPrecision: 'coordinates' as const,
      latitude: 39.9,
      longitude: 116.4,
    };
    const point = stationPosition(station)!;
    expect(point.precision).toBe('region');
    expect(
      coordinatesMatchRegion(stationRegion('CN', '广东省')!, point.latitude, point.longitude),
    ).toBe(true);
  });

  it('does not confuse Shanxi/Shaanxi, ambiguous names, unrelated countries or unavailable regions', () => {
    expect(stationRegion('AF', 'Uruzgan')).toBeNull();
    expect(stationRegion('CN', 'Shanxi')?.id).not.toBe(stationRegion('CN', 'Shaanxi')?.id);
    expect(stationRegion('CN', '广东省/四川省')).toBeNull();
    expect(stationRegion('US', '广东省')).toBeNull();
    expect(stationRegion('CN', 'Unknown region')).toBeNull();
    expect(
      mapPosition({ ...testStation(1), countryCode: 'CN', region: 'Unknown region' })?.precision,
    ).toBe('country');
  });
});
