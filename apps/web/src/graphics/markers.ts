import type { StationPreview } from '@haen/contracts';
import { mapPosition, type MapPosition } from './location.js';
import type { StationGroup } from './model.js';

/** A regional anchor represents a group, never an inferred station address. */
export function stationPosition(station: StationPreview): MapPosition | null {
  return mapPosition(station);
}

export interface StationMarker extends StationGroup {
  groupId: string;
}
export function stationMarkers(groups: readonly StationGroup[]): StationMarker[] {
  const markers: StationMarker[] = [];
  for (const group of groups) {
    if (group.precision !== 'coordinates') {
      markers.push({ ...group, groupId: group.id });
      continue;
    }
    for (const station of group.stations) {
      const point = stationPosition(station);
      if (point)
        markers.push({
          ...point,
          id: `station:${station.id}`,
          groupId: group.id,
          stations: [station],
        });
    }
  }
  return markers;
}
