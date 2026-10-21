import { afterEach, describe, expect, it, vi } from 'vitest';
import { testStation } from '../testing/stations';
import { DwellSelection, explorationAutoplay, globePosition, groupStations } from './model';
import { mapPosition } from './location';
import countries from './countries.json';
afterEach(() => vi.useRealTimers());
describe('geographic scene model', () => {
  it('checks fresh pin, pause and explicit selection before accepting a late dwell', () => {
    const current = {
      stationId: 'a',
      selectionVersion: 7,
      intent: true,
      pinned: false,
      resolving: false,
    };
    const expected = { stationId: 'a', version: 7 };
    expect(explorationAutoplay('dwell', { ...current, pinned: true }, expected)).toBeNull();
    expect(explorationAutoplay('dwell', { ...current, stationId: 'b' }, expected)).toBeNull();
    expect(explorationAutoplay('dwell', { ...current, resolving: true }, expected)).toBeNull();
    expect(explorationAutoplay('dwell', { ...current, selectionVersion: 8 }, expected)).toBeNull();
    expect(explorationAutoplay('dwell', { ...current, intent: false }, expected)).toBe(false);
    expect(explorationAutoplay('listen', { ...current, pinned: true, intent: false })).toBe(true);
    expect(explorationAutoplay('point', { ...current, stationId: null, intent: false })).toBe(true);
    expect(explorationAutoplay('nearby', { ...current, pinned: true, intent: false })).toBe(false);
  });
  it('uses a north-up sphere with predictable geographic axes', () => {
    expect(globePosition(0, 0)).toEqual([0, 0, 1]);
    expect(globePosition(90, 0)[1]).toBeCloseTo(1);
    expect(globePosition(0, 90)[0]).toBeCloseTo(1);
    expect(globePosition(0, 180)[2]).toBeCloseTo(-1);
  });
  it('keeps unknown positions searchable elsewhere and distinguishes far-away cities with identical names', () => {
    const first = {
      ...testStation(1),
      city: 'Same name',
      countryCode: 'US',
      region: 'Region',
      locationPrecision: 'coordinates' as const,
      latitude: 40,
      longitude: -75,
    };
    const nearby = { ...first, id: testStation(2).id, latitude: 40.001 };
    const distant = { ...first, id: testStation(3).id, longitude: -120 };
    const unknown = {
      ...first,
      id: testStation(4).id,
      countryCode: null,
      latitude: null,
      longitude: null,
      locationPrecision: 'unknown' as const,
    };
    const groups = groupStations([first, nearby, distant, unknown]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.stations).toHaveLength(2);
    expect(groups[0]?.latitude).toBe(first.latitude);
    expect(groups[0]?.longitude).toBe(first.longitude);
  });
  it('groups country-only stations separately without inventing city, coordinates or timezone', () => {
    const first = { ...testStation(1), countryCode: 'CH', region: 'Bern' };
    const second = { ...testStation(2), countryCode: 'CH', region: 'Basel' };
    const exact = {
      ...testStation(3),
      countryCode: 'CH',
      locationPrecision: 'coordinates' as const,
      latitude: 46.95,
      longitude: 7.45,
    };
    const before = structuredClone([first, second, exact]);
    const groups = groupStations([first, second, exact, { ...testStation(4), countryCode: 'ZZ' }]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      id: 'country:CH',
      precision: 'country',
      stations: [first, second],
    });
    expect(groups[1]).toMatchObject({ precision: 'coordinates', latitude: 46.95, longitude: 7.45 });
    expect(mapPosition(first)).toMatchObject({ precision: 'country' });
    expect([first, second, exact]).toEqual(before);
    expect(groupStations([second])[0]?.id).toBe('country:CH');
    expect(groupStations([second])[0]?.latitude).toBe(groups[0]?.latitude);
  });
  it('covers small territories while leaving absent country evidence unlocated', () => {
    expect(Object.keys(countries)).toHaveLength(250);
    for (const code of [
      'CN',
      'TW',
      'CH',
      'BQ',
      'BV',
      'CC',
      'CX',
      'GF',
      'GP',
      'MQ',
      'RE',
      'SJ',
      'TK',
      'YT',
    ])
      expect(mapPosition({ ...testStation(1), countryCode: code })?.precision).toBe('country');
    expect(mapPosition({ ...testStation(1), countryCode: null })).toBeNull();
    expect(mapPosition({ ...testStation(1), countryCode: 'ZZ' })).toBeNull();
  });
  it('waits 650ms after the last movement and cancels old pending selections', async () => {
    vi.useFakeTimers();
    const dwell = new DwellSelection(),
      first = vi.fn(),
      second = vi.fn();
    dwell.schedule(first);
    await vi.advanceTimersByTimeAsync(649);
    expect(first).not.toHaveBeenCalled();
    dwell.schedule(second);
    await vi.advanceTimersByTimeAsync(650);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    dwell.schedule(first);
    dwell.cancel();
    await vi.advanceTimersByTimeAsync(1000);
    expect(first).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
