import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ShapeUtils, Vector2 } from 'three';
import { format, resolveConfig } from 'prettier';

const source = {
  name: 'Natural Earth',
  version: '5.1.2',
  url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_map_units.geojson',
  sha256: '57da82be755f4afccd8f3b14251bb2752f5df1395f47d2d86f817470c4a48862',
  license: 'Public domain',
  terms: 'https://www.naturalearthdata.com/about/terms-of-use/',
  fields: ['ISO_A2_EH', 'LABEL_Y', 'LABEL_X', 'POP_EST', 'geometry'],
  selection: 'For repeated country codes use the most populated map unit',
  purpose: 'Country labels and interior display areas; never station coordinates',
};
const [path, extra] = process.argv.slice(2);
if (!path || extra) throw new Error('Usage: node apps/web/scripts/prepare-countries.mjs <geojson>');
const bytes = await readFile(path);
if (
  bytes.length > 20 * 1024 * 1024 ||
  createHash('sha256').update(bytes).digest('hex') !== source.sha256
)
  throw new Error('Country source does not match the reviewed version');
const raw = JSON.parse(bytes.toString('utf8'));
if (raw.type !== 'FeatureCollection' || !Array.isArray(raw.features))
  throw new Error('Invalid country source');
const countries = new Map();
for (const feature of raw.features.sort((a, b) => b.properties.POP_EST - a.properties.POP_EST)) {
  const { ISO_A2_EH: code, LABEL_Y: latitude, LABEL_X: longitude } = feature.properties;
  if (code === '-99') continue;
  if (
    !/^[A-Z]{2}$/.test(code) ||
    !Number.isFinite(latitude) ||
    Math.abs(latitude) > 90 ||
    !Number.isFinite(longitude) ||
    Math.abs(longitude) > 180
  )
    throw new Error('Invalid country label');
  if (countries.has(code)) continue;
  countries.set(
    code,
    [latitude, longitude].map((value) => Number(value.toFixed(5))),
  );
}
if (countries.size !== 250) throw new Error('Incomplete country labels');
const content =
  '{\n' +
  [...countries]
    .sort()
    .map(([code, point]) => `  "${code}": [${point.join(', ')}]`)
    .join(',\n') +
  '\n}\n';
const areas = new Map();
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
for (const feature of raw.features) {
  const code = feature.properties.ISO_A2_EH;
  if (!countries.has(code)) continue;
  const polygons =
    feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  const candidates = areas.get(code) ?? [];
  for (const polygon of polygons) {
    const rings = polygon.map((ring) => ring.slice(0, -1).map(([x, y]) => new Vector2(x, y)));
    const faces = ShapeUtils.triangulateShape(rings[0], rings.slice(1));
    const vertices = rings.flat();
    for (const face of faces) {
      const triangle = face.map((index) => [vertices[index].x, vertices[index].y]);
      if (Math.max(...triangle.map((p) => p[0])) - Math.min(...triangle.map((p) => p[0])) > 180)
        continue;
      const center = [0, 1].map((axis) => triangle.reduce((n, point) => n + point[axis], 0) / 3);
      const weight = Math.abs(cross(...triangle)) * Math.cos((center[1] * Math.PI) / 180);
      if (weight > 1e-15) candidates.push({ triangle, center, weight });
    }
  }
  candidates.sort((a, b) => b.weight - a.weight);
  areas.set(code, candidates.slice(0, 32));
}
const interiors = new Map();
for (const [code, anchor] of countries) {
  let values;
  for (const scale of [10000, 1000000]) {
    const triangles = [];
    for (const { triangle, center } of areas.get(code) ?? []) {
      const quantized = triangle.map((point) => [
        Math.round((center[0] + (point[0] - center[0]) * 0.97 - anchor[1]) * scale),
        Math.round((center[1] + (point[1] - center[1]) * 0.97 - anchor[0]) * scale),
      ]);
      const restored = quantized.map((point) => [
        anchor[1] + point[0] / scale,
        anchor[0] + point[1] / scale,
      ]);
      const sign = Math.sign(cross(...triangle));
      if (
        Math.abs(cross(...restored)) < 1e-16 ||
        restored.some((point) =>
          triangle.some((a, index) => cross(a, triangle[(index + 1) % 3], point) * sign < -1e-12),
        )
      )
        continue;
      triangles.push(...quantized.flat());
      if (triangles.length === 16 * 6) break;
    }
    if (triangles.length) {
      values = [scale, ...triangles];
      break;
    }
  }
  if (!values) throw new Error('Missing safe country interior: ' + code);
  interiors.set(code, values);
}
const interiorContent = await format(JSON.stringify(Object.fromEntries([...interiors].sort())), {
  ...(await resolveConfig(
    fileURLToPath(new URL('../src/graphics/country-interiors.json', import.meta.url)),
  )),
  parser: 'json',
});
await writeFile(new URL('../src/graphics/countries.json', import.meta.url), content);
await writeFile(
  new URL('../src/graphics/country-interiors.json', import.meta.url),
  interiorContent,
);
await writeFile(
  new URL('../public/geography/countries-source.json', import.meta.url),
  JSON.stringify(
    {
      ...source,
      count: countries.size,
      assetSha256: createHash('sha256').update(content).digest('hex'),
      interiorSha256: createHash('sha256').update(interiorContent).digest('hex'),
      interiorScale:
        'Coordinates are offsets from country labels; the first value is the quantization scale',
      interiorRule:
        'Up to sixteen largest safe interior triangles per code, inset and checked against the source face; holes excluded',
    },
    null,
    2,
  ) + '\n',
);
