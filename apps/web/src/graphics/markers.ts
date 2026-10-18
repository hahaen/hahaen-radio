import type { StationPreview } from '@haen/contracts';
import { mapPosition, type MapPosition } from './location.js';
import type { StationGroup } from './model.js';
import interiors from './country-interiors.json' with { type: 'json' };

interface Interior {
  scale: number;
  triangles: readonly number[];
  cumulative: number[];
  area: number;
}
const regions = new Map<string, Interior>();
for (const [code, [scale, ...triangles]] of Object.entries(interiors)) {
  const cumulative: number[] = [];
  let area = 0;
  for (let i = 0; i < triangles.length; i += 6) {
    const [ax, ay, bx, by, cx, cy] = triangles.slice(i, i + 6) as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    area += Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
    cumulative.push(area);
  }
  regions.set(code, { scale: scale!, triangles, cumulative, area });
}

/** Approximate positions are stable display samples inside country land, not station addresses. */
export function stationPosition(station: StationPreview): MapPosition | null {
  const anchor = mapPosition(station);
  if (!anchor || anchor.precision === 'coordinates') return anchor;
  const region = regions.get(station.countryCode!);
  if (!region) return null;
  let seed = 2166136261;
  for (const character of station.id) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const target = random() * region.area;
  const index = region.cumulative.findIndex((value) => value > target) * 6;
  const triangle = region.triangles;
  const u = Math.sqrt(random()),
    v = random();
  const a = 1 - u,
    b = u * (1 - v),
    c = u * v;
  return {
    latitude:
      anchor.latitude +
      (triangle[index + 1]! * a + triangle[index + 3]! * b + triangle[index + 5]! * c) /
        region.scale,
    longitude:
      anchor.longitude +
      (triangle[index]! * a + triangle[index + 2]! * b + triangle[index + 4]! * c) / region.scale,
    precision: 'country',
  };
}

export interface StationMarker extends StationGroup {
  groupId: string;
  memberIndex: number;
  memberCount: number;
}
export function stationMarkers(groups: readonly StationGroup[]): StationMarker[] {
  const markers: StationMarker[] = [];
  for (const group of groups)
    for (const [memberIndex, station] of group.stations.entries()) {
      const point = stationPosition(station);
      if (point)
        markers.push({
          ...point,
          id: `station:${station.id}`,
          groupId: group.id,
          memberIndex,
          memberCount: group.stations.length,
          stations: [station],
        });
    }
  return markers;
}
