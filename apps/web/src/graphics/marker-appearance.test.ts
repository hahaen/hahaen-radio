import { describe, expect, it } from 'vitest';
import { markerCrowding } from './marker-appearance';

describe('station point appearance', () => {
  it('softens crowded points while preserving every position and leaving isolated points clear', () => {
    const positions = new Float32Array([
      ...Array.from({ length: 500 }, () => [1.012, 0, 0]).flat(),
      -1.012,
      0,
      0,
    ]);
    const before = positions.slice();
    const crowding = markerCrowding(positions);
    expect(crowding).toHaveLength(501);
    expect(crowding[0]).toBeGreaterThan(0.5);
    expect(crowding.at(-1)).toBe(0);
    expect(Array.from(crowding).every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(positions).toEqual(before);
  });

  it('keeps empty catalogs safe and appearance independent of input order', () => {
    expect(markerCrowding(new Float32Array())).toHaveLength(0);
    const coordinates = [
      [1.01, 0, 0],
      [1.012, 0.001, 0],
      [-1.01, 0, 0],
    ];
    const forward = markerCrowding(new Float32Array(coordinates.flat()));
    const reverse = markerCrowding(new Float32Array(coordinates.toReversed().flat()));
    expect(Array.from(forward)).toEqual(Array.from(reverse).toReversed());
  });
});
