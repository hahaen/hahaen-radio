import { describe, expect, it } from 'vitest';
import { testStation } from '../testing/stations';
import { groupStations } from './model';
import { stationMarkers, stationPosition } from './markers';
import countries from './countries.json';

describe('individual station display points', () => {
  it('keeps every station marker beyond the expansion limit and preserves coincident source coordinates', () => {
    const exact = Array.from({ length: 120 }, (_, i) => ({
      ...testStation(i + 1),
      latitude: 51.5,
      longitude: -0.1,
      locationPrecision: 'coordinates' as const,
    }));
    const markers = stationMarkers(groupStations(exact));
    expect(markers).toHaveLength(120);
    expect(new Set(markers.map((point) => point.id)).size).toBe(120);
    expect(
      markers.every(
        (point) =>
          point.stations.length === 1 && point.latitude === 51.5 && point.longitude === -0.1,
      ),
    ).toBe(true);
  });
  it('keeps one country group stable when filtering or reordering, without changing evidence', () => {
    const stations = Array.from({ length: 1000 }, (_, i) => ({
      ...testStation(i + 1),
      countryCode: 'CH',
    }));
    const before = structuredClone(stations);
    const markers = stationMarkers(groupStations(stations));
    expect(markers).toHaveLength(1);
    expect(markers[0]?.stations).toHaveLength(1000);
    const picked = stations[500]!;
    expect(stationMarkers(groupStations([picked]))[0]).toMatchObject(stationPosition(picked)!);
    expect(stationMarkers(groupStations(stations.toReversed()))[0]).toMatchObject(
      stationPosition(picked)!,
    );
    expect(stations).toEqual(before);
    expect(markers[0]?.precision).toBe('country');
  });
  it('covers all supported codes including small islands and excludes unknown countries', () => {
    for (const code of Object.keys(countries)) {
      const point = stationPosition({ ...testStation(1), countryCode: code });
      expect(point?.precision).toBe('country');
      expect(Math.abs(point!.latitude)).toBeLessThanOrEqual(90);
      expect(Math.abs(point!.longitude)).toBeLessThanOrEqual(180);
    }
    expect(stationPosition({ ...testStation(1), countryCode: null })).toBeNull();
    expect(stationPosition({ ...testStation(1), countryCode: 'ZZ' })).toBeNull();
  });
});
