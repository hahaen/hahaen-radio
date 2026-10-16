import type { StationPreview } from '@haen/contracts';
export interface StationGroup {
  id: string;
  latitude: number;
  longitude: number;
  stations: StationPreview[];
}
export function globePosition(
  latitude: number,
  longitude: number,
  radius = 1,
): [number, number, number] {
  const lat = (latitude * Math.PI) / 180,
    lon = (longitude * Math.PI) / 180;
  return [
    Math.cos(lat) * Math.sin(lon) * radius,
    Math.sin(lat) * radius,
    Math.cos(lat) * Math.cos(lon) * radius,
  ];
}
export function groupStations(stations: readonly StationPreview[]): StationGroup[] {
  const groups = new Map<string, StationGroup>();
  for (const station of stations) {
    if (
      station.locationPrecision !== 'coordinates' ||
      station.latitude === null ||
      station.longitude === null
    )
      continue;
    const id =
      station.city && station.countryCode
        ? `city:${station.countryCode}:${station.region ?? ''}:${station.city}:${Math.floor(station.latitude * 2)}:${Math.floor(station.longitude * 2)}`
        : `near:${station.countryCode ?? ''}:${Math.floor(station.latitude * 12)}:${Math.floor(((((station.longitude + 180) % 360) + 360) % 360) * 12)}`;
    const group = groups.get(id) ?? {
      id,
      latitude: station.latitude,
      longitude: station.longitude,
      stations: [],
    };
    group.stations.push(station);
    groups.set(id, group);
  }
  return [...groups.values()];
}
export class DwellSelection {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  get pending() {
    return this.timer !== undefined;
  }
  cancel() {
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
  schedule(action: () => void) {
    this.cancel();
    const expected = this.generation;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (expected === this.generation) action();
    }, 650);
  }
}

export type ExplorationChoice = 'listen' | 'point' | 'dwell' | 'nearby';
export interface SceneExpectation {
  stationId: string | null;
  version: number;
}
export function explorationAutoplay(
  reason: ExplorationChoice,
  current: {
    stationId: string | null;
    selectionVersion: number;
    intent: boolean;
    pinned: boolean;
    resolving: boolean;
  },
  expected?: SceneExpectation,
): boolean | null {
  if (
    reason === 'dwell' &&
    (!expected ||
      current.pinned ||
      current.resolving ||
      current.stationId !== expected.stationId ||
      current.selectionVersion !== expected.version)
  )
    return null;
  if (reason === 'listen' || (reason === 'point' && current.stationId === null)) return true;
  return current.intent;
}
