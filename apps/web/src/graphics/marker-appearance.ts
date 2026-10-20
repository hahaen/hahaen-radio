/** Smooth local visual density; positions and the number of station markers stay intact. */
export function markerCrowding(positions: Float32Array): Float32Array {
  const cells = new Map<number, number>();
  const key = (x: number, y: number, z: number) => x + 32 + (y + 32) * 64 + (z + 32) * 4096;
  for (let i = 0; i < positions.length; i += 3) {
    const id = key(
      Math.floor(positions[i]! * 24),
      Math.floor(positions[i + 1]! * 24),
      Math.floor(positions[i + 2]! * 24),
    );
    cells.set(id, (cells.get(id) ?? 0) + 1);
  }
  const result = new Float32Array(positions.length / 3);
  for (let i = 0; i < result.length; i++) {
    const x = positions[i * 3]! * 24,
      y = positions[i * 3 + 1]! * 24,
      z = positions[i * 3 + 2]! * 24;
    let density = 0,
      totalWeight = 0;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const cx = Math.floor(x) + dx,
            cy = Math.floor(y) + dy,
            cz = Math.floor(z) + dz;
          const weight =
            Math.max(0, 1 - Math.abs(x - cx - 0.5) / 1.5) *
            Math.max(0, 1 - Math.abs(y - cy - 0.5) / 1.5) *
            Math.max(0, 1 - Math.abs(z - cz - 0.5) / 1.5);
          density += (cells.get(key(cx, cy, cz)) ?? 0) * weight;
          totalWeight += weight;
        }
    result[i] = Math.min(1, Math.max(0, Math.log2(Math.max(1, density / totalWeight)) / 7));
  }
  return result;
}
