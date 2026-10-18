import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const source = {
  name: 'Natural Earth',
  version: '5.1.2',
  url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_map_units.geojson',
  sha256: '57da82be755f4afccd8f3b14251bb2752f5df1395f47d2d86f817470c4a48862',
  license: 'Public domain',
  terms: 'https://www.naturalearthdata.com/about/terms-of-use/',
  fields: ['ISO_A2_EH', 'LABEL_Y', 'LABEL_X', 'POP_EST'],
  selection: 'For repeated country codes use the most populated map unit',
  purpose: 'Country-level map labels; never station coordinates',
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
await writeFile(new URL('../src/graphics/countries.json', import.meta.url), content);
await writeFile(
  new URL('../public/geography/countries-source.json', import.meta.url),
  JSON.stringify(
    {
      ...source,
      count: countries.size,
      assetSha256: createHash('sha256').update(content).digest('hex'),
    },
    null,
    2,
  ) + '\n',
);
