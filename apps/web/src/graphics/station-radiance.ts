import type { StationMarker } from './markers.js';

export const STATION_RADIANCE_WIDTH = 2048;
export const STATION_RADIANCE_HEIGHT = 1024;

const degreesPerPixel = 360 / STATION_RADIANCE_WIDTH;
const broadSigma = 0.35;
const coreSigma = 0.12;
const radius = Math.ceil((broadSigma * 3.5) / degreesPerPixel);
const gaussian = (degrees: number, sigma: number) =>
  Math.exp(-(degrees * degrees) / (2 * sigma * sigma));

/** A decorative light field from precise station locations, with north at v=0. */
export function rasterizeStationRadiance(markers: readonly StationMarker[]): Uint8Array {
  const width = STATION_RADIANCE_WIDTH,
    height = STATION_RADIANCE_HEIGHT;
  const occupied = new Uint8Array(width * height);
  const sourceRows = new Uint8Array(height);
  for (const marker of markers) {
    const { latitude, longitude } = marker;
    if (
      marker.precision !== 'coordinates' ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    )
      continue;
    const x = Math.floor((((longitude + 180) % 360) / 360) * width);
    const y = Math.min(height - 1, Math.floor(((90 - latitude) / 180) * height));
    // One source per texel keeps shared coordinates from becoming an oversized light.
    occupied[y * width + x] = 1;
    sourceRows[y] = 1;
  }

  const result = new Uint8Array(width * height);
  if (!sourceRows.some(Boolean)) return result;
  // Separate longitude and latitude passes keep large catalogs out of a per-source 2D loop.
  const broad = new Float32Array(width * height);
  const core = new Float32Array(width * height);
  const affectedRows = new Uint8Array(height);
  const broadVertical = Array.from({ length: radius * 2 + 1 }, (_, i) =>
    gaussian((i - radius) * degreesPerPixel, broadSigma),
  );
  const coreVertical = Array.from({ length: radius * 2 + 1 }, (_, i) =>
    gaussian((i - radius) * degreesPerPixel, coreSigma),
  );
  for (let y = 0; y < height; y++) {
    if (!sourceRows[y]) continue;
    const latitude = 90 - (y + 0.5) * degreesPerPixel;
    const longitudeScale = Math.cos((latitude * Math.PI) / 180);
    const horizontalRadius = Math.ceil(radius / longitudeScale);
    // An even-width row contains the antipodal longitude only once.
    const left = -Math.min(width / 2, horizontalRadius);
    const right = Math.min(width / 2 - 1, horizontalRadius);
    const broadHorizontal = Array.from({ length: right - left + 1 }, (_, i) =>
      gaussian((i + left) * degreesPerPixel * longitudeScale, broadSigma),
    );
    const coreHorizontal = Array.from({ length: right - left + 1 }, (_, i) =>
      gaussian((i + left) * degreesPerPixel * longitudeScale, coreSigma),
    );
    affectedRows.fill(1, Math.max(0, y - radius), Math.min(height, y + radius + 1));
    for (let x = 0; x < width; x++) {
      if (!occupied[y * width + x]) continue;
      for (let dx = left; dx <= right; dx++) {
        const wrappedX = (x + dx + width) % width;
        const index = y * width + wrappedX;
        broad[index] = broad[index]! + broadHorizontal[dx - left]!;
        core[index] = core[index]! + coreHorizontal[dx - left]!;
      }
    }
  }

  for (let y = 0; y < height; y++) {
    if (!affectedRows[y]) continue;
    const firstRow = Math.max(0, y - radius),
      lastRow = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x++) {
      let energy = 0;
      for (let row = firstRow; row <= lastRow; row++) {
        const index = row * width + x,
          offset = row - y + radius;
        energy +=
          broad[index]! * broadVertical[offset]! * 0.7 + core[index]! * coreVertical[offset]! * 0.3;
      }
      result[y * width + x] = Math.round((210 * energy) / (energy + 1.2));
    }
  }
  return result;
}
