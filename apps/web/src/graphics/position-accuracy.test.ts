import { beforeAll, describe, expect, it } from 'vitest';
import { testStation } from '../testing/stations';
import { stationPosition, stationMarkers } from './markers';
import { groupStations } from './model';

import data from '../../public/geography/regions.json';
import { loadRegions } from './regions';

beforeAll(async () => {
  await loadRegions(new AbortController().signal, async () => new Response(JSON.stringify(data)));
});

describe('geographic accuracy rather than decorative placement', () => {
  it('does not invent different locations from station IDs with identical evidence', () => {
    const a = { ...testStation(1), countryCode: 'CN' };
    const b = { ...a, id: testStation(2).id };
    expect(stationPosition(a)).toEqual(stationPosition(b));
  });
  it('does not invent city locations inside a known province', () => {
    const stations = [1, 2, 3].map((id) => ({
      ...testStation(id),
      countryCode: 'CN',
      region: '广东省',
    }));
    const markers = stationMarkers(groupStations(stations));
    expect(markers).toHaveLength(1);
    expect(markers[0]?.precision).toBe('region');
    for (const station of stations)
      expect(stationPosition(station)).toEqual(stationPosition(stations[0]!));
    expect(markers[0]?.stations).toEqual(stations);
  });
  it('represents country-only stations with one explicitly approximate group', () => {
    const stations = [testStation(1), testStation(2)];
    const markers = stationMarkers(groupStations(stations));
    expect(markers).toHaveLength(1);
    expect(markers[0]?.stations).toEqual(stations);
  });
});
