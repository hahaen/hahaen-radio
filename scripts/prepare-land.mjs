import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const source = {
  name: 'Natural Earth',
  version: '5.1.2',
  url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_land.geojson',
  sha256: '9e0729ee253ca7d7a5c4ae9395fb1902264c5377c52e224d13dd85010e2835d9',
  license: 'Public domain',
  terms: 'https://www.naturalearthdata.com/about/terms-of-use/',
};
const [path, extra] = process.argv.slice(2);
if (!path || extra) throw new Error('Usage: node scripts/prepare-land.mjs <downloaded-geojson>');
const data = await readFile(path);
if (data.length > 1024 * 1024 || createHash('sha256').update(data).digest('hex') !== source.sha256)
  throw new Error('Land source does not match the reviewed version');
const raw = JSON.parse(data.toString('utf8'));
if (raw.type !== 'FeatureCollection' || !Array.isArray(raw.features))
  throw new Error('Invalid land source');
const polygons = raw.features.flatMap((feature) => {
  const geometry = feature.geometry;
  if (geometry?.type !== 'Polygon' || !Array.isArray(geometry.coordinates))
    throw new Error('Invalid polygon');
  return [
    geometry.coordinates.map((ring) => {
      if (!Array.isArray(ring) || ring.length < 4) throw new Error('Invalid ring');
      return ring.map((point) => {
        if (
          !Array.isArray(point) ||
          point.length !== 2 ||
          !point.every(Number.isFinite) ||
          Math.abs(point[0]) > 180 ||
          Math.abs(point[1]) > 90
        )
          throw new Error('Invalid point');
        return point.map((value) => Number(value.toFixed(5)));
      });
    }),
  ];
});
function inside(point, ring) {
  let found = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      found = !found;
  }
  return found;
}
const bounded = polygons.map((rings) => ({
  rings,
  minX: Math.min(...rings[0].map((p) => p[0])),
  maxX: Math.max(...rings[0].map((p) => p[0])),
  minY: Math.min(...rings[0].map((p) => p[1])),
  maxY: Math.max(...rings[0].map((p) => p[1])),
}));
const points = [];
for (let lat = -88.75; lat < 89; lat += 1.25) {
  const step = 1.25 / Math.cos((lat * Math.PI) / 180);
  for (let lon = -180 + step / 2; lon < 180; lon += step) {
    const point = [lon, lat];
    if (
      bounded.some(
        (poly) =>
          lon >= poly.minX &&
          lon <= poly.maxX &&
          lat >= poly.minY &&
          lat <= poly.maxY &&
          inside(point, poly.rings[0]) &&
          !poly.rings.slice(1).some((ring) => inside(point, ring)),
      )
    )
      points.push(point.map((value) => Number(value.toFixed(5))));
  }
}
const directory = new URL('../apps/web/public/geography/', import.meta.url);
await mkdir(directory, { recursive: true });
const body = JSON.stringify({ version: 1, polygons, points }) + '\n';
await writeFile(new URL('land.json', directory), body);
const project = (point) =>
  [(point[0] + 180) * 2, (90 - point[1]) * 2].map((n) => n.toFixed(3)).join(',');
const paths = polygons
  .map(
    (rings) =>
      '<path d="' + rings.map((ring) => 'M' + ring.map(project).join('L') + 'Z').join('') + '"/>',
  )
  .join('');
await writeFile(
  new URL('world.svg', directory),
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 360"><g fill="#15252d" stroke="#83aaa3" stroke-width="0.6" fill-rule="evenodd">' +
    paths +
    '</g></svg>\n',
);
await writeFile(
  new URL('source.json', directory),
  JSON.stringify(
    {
      ...source,
      assetSha256: createHash('sha256').update(body).digest('hex'),
      polygonCount: polygons.length,
      pointCount: points.length,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({
    event: 'land_prepared',
    polygons: polygons.length,
    points: points.length,
    bytes: Buffer.byteLength(body),
  }),
);
