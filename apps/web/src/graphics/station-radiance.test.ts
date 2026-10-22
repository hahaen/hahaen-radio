import { describe, expect, it } from 'vitest';
import type { StationMarker } from './markers';
import {
  rasterizeStationRadiance,
  STATION_RADIANCE_HEIGHT,
  STATION_RADIANCE_WIDTH,
} from './station-radiance';

const marker = (
  longitude: number,
  latitude: number,
  precision: StationMarker['precision'] = 'coordinates',
): StationMarker => ({
  id: `${precision}:${longitude}:${latitude}`,
  groupId: 'test',
  longitude,
  latitude,
  precision,
  stations: [],
});
const sample = (data: Uint8Array, longitude: number, latitude: number) => {
  const x = Math.floor((((longitude + 180) % 360) / 360) * STATION_RADIANCE_WIDTH);
  const y = Math.min(
    STATION_RADIANCE_HEIGHT - 1,
    Math.floor(((90 - latitude) / 180) * STATION_RADIANCE_HEIGHT),
  );
  return data[y * STATION_RADIANCE_WIDTH + x]!;
};
const samePixels = (left: Uint8Array, right: Uint8Array) =>
  left.every((value, index) => value === right[index]);

describe('station radiance', () => {
  it('places light at its geographic longitude and latitude with north above south', () => {
    const data = rasterizeStationRadiance([marker(30, 45), marker(-60, -30)]);
    expect(data).toHaveLength(STATION_RADIANCE_WIDTH * STATION_RADIANCE_HEIGHT);
    expect(sample(data, 30, 45)).toBeGreaterThan(0);
    expect(sample(data, -60, -30)).toBeGreaterThan(0);
    expect(sample(data, 30, -45)).toBe(0);
    expect(sample(data, -60, 30)).toBe(0);
    expect(sample(data, 0, 0)).toBe(0);
  });

  it('wraps light continuously across the date line and treats both 180-degree meridians alike', () => {
    const data = rasterizeStationRadiance([marker(179.95, 0)]);
    expect(sample(data, 179.9, 0)).toBeGreaterThan(0);
    expect(sample(data, -179.9, 0)).toBeGreaterThan(0);
    // The texels on either side of the source have equal light, including across the seam.
    const step = 360 / STATION_RADIANCE_WIDTH;
    expect(sample(data, -180 + step / 2, 0)).toBe(sample(data, 180 - step * 1.5, 0));
    expect(sample(data, 0, 0)).toBe(0);
    expect(
      samePixels(
        rasterizeStationRadiance([marker(180, 0)]),
        rasterizeStationRadiance([marker(-180, 0)]),
      ),
    ).toBe(true);
  });

  it('does not invent lights for regional anchors, unknown locations or invalid coordinates', () => {
    const data = rasterizeStationRadiance([
      marker(116.4, 39.9, 'country'),
      marker(113.3, 23.1, 'region'),
      marker(Number.NaN, 0),
      marker(0, Infinity),
      marker(0, 91),
      marker(181, 0),
    ]);
    expect(data.some((value) => value !== 0)).toBe(false);
    expect(rasterizeStationRadiance([]).some((value) => value !== 0)).toBe(false);
  });

  it('keeps shared coordinates and same-texel stations from raising the peak or changing the footprint', () => {
    const point = Object.freeze(marker(30.1, 45.1));
    const single = rasterizeStationRadiance([point]);
    const repeated = rasterizeStationRadiance(Object.freeze(Array(1000).fill(point)));
    const neighbors = [point, marker(30.11, 45.11)];
    expect(samePixels(single, repeated)).toBe(true);
    expect(samePixels(single, rasterizeStationRadiance(neighbors))).toBe(true);
    expect(samePixels(single, rasterizeStationRadiance(neighbors.toReversed()))).toBe(true);
  });

  it('blends nearby real locations smoothly while keeping every pixel below white', () => {
    const single = rasterizeStationRadiance([marker(-0.7, 0)]);
    const blended = rasterizeStationRadiance([marker(-0.7, 0), marker(0.7, 0)]);
    expect(sample(blended, 0, 0)).toBeGreaterThan(sample(single, 0, 0));
    expect(sample(blended, 0, 0)).toBeGreaterThan(sample(blended, 3, 0));
    expect(blended.every((value) => value < 255)).toBe(true);
    expect(sample(blended, 8, 0)).toBe(0);
  });

  it('accounts for narrowing longitude distances toward the poles', () => {
    const equator = rasterizeStationRadiance([marker(0, 0)]);
    const north = rasterizeStationRadiance([marker(0, 60)]);
    const south = rasterizeStationRadiance([marker(0, -60)]);
    expect(sample(north, 2, 60)).toBeGreaterThan(sample(equator, 2, 0) * 1.25);
    expect(sample(south, 2, -60)).toBeGreaterThan(sample(equator, 2, 0) * 1.25);
  });
});
