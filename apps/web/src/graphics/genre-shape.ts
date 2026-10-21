/** Stable, decorative samples; category counts remain the source of truth. */
export function genrePoint(index: number, count: number, category: number) {
  const t = (index + 0.5) / Math.max(1, count);
  const noise = Math.sin(index * 127.1 + category * 31.7);
  const seed = ((Math.imul(index + 1, 2654435761) >>> 0) % 65536) / 65536;
  const form = category % 4;
  let radius: number, angle: number, flatten: number;
  if (form === 0) {
    radius = Math.sqrt(t);
    angle = (index % 3) * ((Math.PI * 2) / 3) + radius * 5 + noise * 0.85;
    flatten = 0.68;
  } else if (form === 1) {
    radius = 0.46 + t * 0.48 + noise * 0.06;
    angle = index * 2.3999632297;
    flatten = 0.78;
  } else if (form === 2) {
    radius = Math.sqrt(t) * (0.72 + seed * 0.28);
    angle = index * 2.3999632297;
    flatten = 0.94;
  } else {
    radius = Math.pow(t, 0.72);
    angle = (index % 2) * Math.PI + radius * 6.8 + noise * 0.62;
    flatten = 0.55;
  }
  const scatter = Math.sin(index * 93.7) * radius * 0.1;
  return {
    x: Math.cos(angle) * radius + scatter,
    y: (Math.sin(angle) * radius + Math.cos(index * 73.3) * radius * 0.08) * flatten,
    z: noise * radius * 0.12,
    strength: 0.35 + seed * 0.65,
  };
}
