import type { LandData } from './land';

export const LAND_MASK_WIDTH = 1024;
export const LAND_MASK_HEIGHT = 512;

/** Rasterize the local coastline, including holes, without fetching a basemap. */
export function rasterizeLand(polygons: LandData['polygons']) {
  const data = new Uint8Array(LAND_MASK_WIDTH * LAND_MASK_HEIGHT);
  for (const polygon of polygons) {
    let minY = LAND_MASK_HEIGHT,
      maxY = 0;
    const rings = polygon.map((ring) =>
      ring.map(([longitude, latitude]) => {
        const x = ((longitude + 180) / 360) * LAND_MASK_WIDTH;
        const y = ((90 - latitude) / 180) * LAND_MASK_HEIGHT;
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        return [x, y] as const;
      }),
    );
    const first = Math.max(0, Math.floor(minY));
    const last = Math.min(LAND_MASK_HEIGHT, Math.ceil(maxY));
    for (let row = first; row < last; row++) {
      const y = row + 0.5;
      const crossings: number[] = [];
      for (const ring of rings)
        for (let index = 0; index < ring.length; index++) {
          const a = ring[index]!,
            b = ring[(index + 1) % ring.length]!;
          if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y))
            crossings.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
        }
      crossings.sort((a, b) => a - b);
      for (let index = 0; index + 1 < crossings.length; index += 2) {
        const start = Math.max(0, Math.ceil(crossings[index]! - 0.5));
        const end = Math.min(LAND_MASK_WIDTH, Math.ceil(crossings[index + 1]! - 0.5));
        data.fill(255, row * LAND_MASK_WIDTH + start, row * LAND_MASK_WIDTH + end);
      }
    }
  }
  return data;
}
