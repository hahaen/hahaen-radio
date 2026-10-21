import { describe, expect, it } from 'vitest';
import geography from '../../public/geography/land.json';
import type { LandData } from './land';
import { LAND_MASK_WIDTH, LAND_MASK_HEIGHT, rasterizeLand } from './land-mask';

const sample = (data: Uint8Array, longitude: number, latitude: number) => {
  const x = Math.floor(((longitude + 180) / 360) * LAND_MASK_WIDTH);
  const y = Math.floor(((90 - latitude) / 180) * LAND_MASK_HEIGHT);
  return data[y * LAND_MASK_WIDTH + x];
};

describe('globe land surface', () => {
  it('keeps continental interiors, oceans and the south-pole seam geographically aligned', () => {
    const data = rasterizeLand((geography as LandData).polygons);
    expect(data).toHaveLength(LAND_MASK_WIDTH * LAND_MASK_HEIGHT);
    for (const [longitude, latitude] of [
      [15, 20],
      [100, 40],
      [-55, -10],
      [135, -25],
      [20, -80],
      [-170, -85],
    ])
      expect(sample(data, longitude!, latitude!)).toBe(255);
    for (const [longitude, latitude] of [
      [-140, 0],
      [0, 0],
      [20, -50],
      [-30, 40],
    ])
      expect(sample(data, longitude!, latitude!)).toBe(0);
  });

  it('preserves water holes and separate islands rather than filling their bounding boxes', () => {
    const ring = (left: number, bottom: number, right: number, top: number) =>
      [
        [left, bottom],
        [right, bottom],
        [right, top],
        [left, top],
        [left, bottom],
      ] as [number, number][];
    const data = rasterizeLand([
      [ring(-30, -30, 30, 30), ring(-10, -10, 10, 10)],
      [ring(60, -10, 80, 10)],
    ]);
    expect(sample(data, 20, 0)).toBe(255);
    expect(sample(data, 0, 0)).toBe(0);
    expect(sample(data, 45, 0)).toBe(0);
    expect(sample(data, 70, 0)).toBe(255);
  });
});
