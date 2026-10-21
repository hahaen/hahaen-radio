// Quarter-degree cells retain boundary cells for coarse geographic plausibility checks.
export function coverageRuns(polygons, scale = 4) {
  const width = 360 * scale,
    height = 180 * scale;
  const cells = new Uint8Array(width * height);
  const mark = (x, y) => {
    if (y >= 0 && y < height) cells[y * width + (((x % width) + width) % width)] = 1;
  };
  for (const polygon of polygons) {
    const rings = polygon.map((ring) =>
      ring.map(([lon, lat]) => [(lon + 180) * scale, (90 - lat) * scale]),
    );
    const ys = rings[0].map((p) => p[1]);
    for (
      let row = Math.max(0, Math.floor(Math.min(...ys)));
      row < Math.min(height, Math.ceil(Math.max(...ys)));
      row++
    ) {
      const crossings = [],
        y = row + 0.5;
      for (const ring of rings)
        for (let i = 1; i < ring.length; i++) {
          const a = ring[i - 1],
            b = ring[i];
          if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y))
            crossings.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
        }
      crossings.sort((a, b) => a - b);
      for (let i = 0; i + 1 < crossings.length; i += 2)
        for (
          let x = Math.max(0, Math.ceil(crossings[i] - 0.5));
          x < Math.min(width, Math.ceil(crossings[i + 1] - 0.5));
          x++
        )
          mark(x, row);
    }
    // Include boundary cells, so coastlines, small islands and enclaves survive quantization.
    for (const ring of rings)
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1],
          b = ring[i];
        const steps = Math.max(
          1,
          Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) * 2),
        );
        for (let j = 0; j <= steps; j++)
          mark(
            Math.floor(a[0] + ((b[0] - a[0]) * j) / steps),
            Math.min(height - 1, Math.floor(a[1] + ((b[1] - a[1]) * j) / steps)),
          );
      }
  }
  const runs = [];
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i]) continue;
    const start = i;
    while (i + 1 < cells.length && cells[i + 1]) i++;
    runs.push(start, i - start + 1);
  }
  return runs;
}
