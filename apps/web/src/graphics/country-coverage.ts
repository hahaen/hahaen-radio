import coverage from './country-coverage.json' with { type: 'json' };

const countries: Readonly<Record<string, readonly number[]>> = coverage;

/** Coarse plausibility check, with one cell of tolerance near borders and coasts. */
export function coordinatesMatchCountry(code: string, latitude: number, longitude: number) {
  const runs = countries[code];
  if (!runs) return false;
  return (
    coverageContains(runs, latitude, longitude, 2) ||
    (code === 'CN' &&
      ['TW', 'HK', 'MO'].some((part) => coverageContains(countries[part]!, latitude, longitude, 2)))
  );
}

export function coverageContains(
  runs: readonly number[],
  latitude: number,
  longitude: number,
  scale = 4,
) {
  const width = 360 * scale,
    height = 180 * scale;
  const x = Math.floor((longitude + 180) * scale) % width;
  const y = Math.min(height - 1, Math.floor((90 - latitude) * scale));
  const contains = (cell: number) => {
    let low = 0,
      high = runs.length / 2;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (runs[mid * 2]! <= cell) low = mid + 1;
      else high = mid;
    }
    return low > 0 && cell < runs[(low - 1) * 2]! + runs[(low - 1) * 2 + 1]!;
  };
  for (let dy = -1; dy <= 1; dy++) {
    if (y + dy < 0 || y + dy >= height) continue;
    for (let dx = -1; dx <= 1; dx++)
      if (contains((y + dy) * width + ((x + dx + width) % width))) return true;
  }
  return false;
}
