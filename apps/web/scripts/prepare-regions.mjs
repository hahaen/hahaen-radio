import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { ShapeUtils, Vector2 } from 'three';
import { coverageRuns } from './geography-coverage.mjs';

const sha256 = '22d0e3ad85eb3e27f17cabf8ba2d50e554fbc27a87796ff891d958185da62fb5';
const [path, extra] = process.argv.slice(2);
if (!path || extra) throw new Error('Usage: prepare-regions.mjs <geojson>');
const bytes = await readFile(path);
if (bytes.length > 50 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== sha256)
  throw new Error('Region source does not match the reviewed version');
const world = JSON.parse(bytes.toString('utf8'));
const regions = {};
for (const feature of world.features) {
  const p = feature.properties,
    code = p.iso_a2;
  if (!/^[A-Z]{2}$/.test(code)) continue;
  const polygons =
    feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  let best = null,
    area = 0;
  for (const polygon of polygons) {
    const rings = polygon.map((r) => r.slice(0, -1).map(([x, y]) => new Vector2(x, y)));
    const vertices = rings.flat();
    for (const face of ShapeUtils.triangulateShape(rings[0], rings.slice(1))) {
      const points = face.map((i) => vertices[i]);
      if (Math.max(...points.map((v) => v.x)) - Math.min(...points.map((v) => v.x)) > 180) continue;
      const [a, b, c] = points;
      const weight = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
      if (weight > area) {
        area = weight;
        best = points;
      }
    }
  }
  if (!best) throw new Error('Missing region interior');
  const cx = best.reduce((s, p) => s + p.x, 0) / 3,
    cy = best.reduce((s, p) => s + p.y, 0) / 3;
  const triangle = best.flatMap((p) => [
    Number((cx + (p.x - cx) * 0.95).toFixed(5)),
    Number((cy + (p.y - cy) * 0.95).toFixed(5)),
  ]);
  const aliases = [
    ...new Set(
      [
        'name',
        'name_en',
        'name_zh',
        'name_local',
        'name_alt',
        'gn_name',
        'iso_3166_2',
        'postal',
        'adm1_code',
      ].flatMap((k) => (typeof p[k] === 'string' ? p[k].split('|') : [])),
    ),
  ];
  (regions[code] ??= []).push([p.adm1_code, aliases, triangle, coverageRuns(polygons)]);
}
const content = JSON.stringify(Object.fromEntries(Object.entries(regions).sort())) + '\n';
const assetSha256 = createHash('sha256').update(content).digest('hex');
await writeFile(new URL('../public/geography/regions.json', import.meta.url), content);
await writeFile(
  new URL('../src/graphics/region-version.ts', import.meta.url),
  `export const REGION_DATA_VERSION =\n  '${assetSha256}';\n`,
);
await writeFile(
  new URL('../public/geography/regions-source.json', import.meta.url),
  JSON.stringify(
    {
      name: 'Natural Earth',
      version: '5.1.2',
      license: 'Public domain',
      url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_1_states_provinces.geojson',
      sha256,
      assetSha256,
      count: Object.values(regions).reduce((n, items) => n + items.length, 0),
      purpose:
        'Province/state aliases, safe interior triangles and quarter-degree coverage; approximate display only',
    },
    null,
    2,
  ) + '\n',
);
