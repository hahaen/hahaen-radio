import { afterEach, describe, expect, it, vi } from 'vitest';
import { testStation } from '../testing/stations';
import { DwellSelection, explorationAutoplay, globePosition, groupStations } from './model';
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
      latitude: 20,
      longitude: 80,
    };
    const nearby = { ...first, id: testStation(2).id, latitude: 20.001 };
    const distant = { ...first, id: testStation(3).id, longitude: -80 };
    const unknown = { ...first, id: testStation(4).id, locationPrecision: 'country' as const };
    const groups = groupStations([first, nearby, distant, unknown]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.stations).toHaveLength(2);
    expect(groups[0]?.latitude).toBe(first.latitude);
    expect(groups[0]?.longitude).toBe(first.longitude);
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
