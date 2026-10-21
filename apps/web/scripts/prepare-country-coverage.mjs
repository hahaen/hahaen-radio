import { coverageRuns } from './geography-coverage.mjs';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';

// A conservative land-cell index for rejecting coordinates in a different country.
const [path, extra] = process.argv.slice(2);
if (!path || extra) throw new Error('Usage: prepare-country-coverage.mjs <geojson>');
const source = JSON.parse(
  await readFile(new URL('../public/geography/countries-source.json', import.meta.url), 'utf8'),
);
const bytes = await readFile(path);
if (createHash('sha256').update(bytes).digest('hex') !== source.sha256)
  throw new Error('Country source does not match the reviewed version');
const world = JSON.parse(bytes.toString('utf8'));
const regions = new Map();
for (const feature of world.features) {
  const code = feature.properties.ISO_A2_EH;
  if (!/^[A-Z]{2}$/.test(code)) continue;
  const polygons =
    feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  regions.set(code, [...(regions.get(code) ?? []), ...polygons]);
}
const coverage = {};
for (const [code, polygons] of [...regions].sort()) {
  const runs = coverageRuns(polygons, 2);
  coverage[code] = runs;
}
if (Object.keys(coverage).length !== 250) throw new Error('Incomplete country coverage');
const output = new URL('../src/graphics/country-coverage.json', import.meta.url);
const content = await format(JSON.stringify(coverage), {
  ...(await resolveConfig(fileURLToPath(output))),
  parser: 'json',
});
await writeFile(output, content);
source.coverageSha256 = createHash('sha256').update(content).digest('hex');
source.coverageRule =
  'Half-degree land cells including boundary cells, encoded as start/length runs; display plausibility only';
await writeFile(
  new URL('../public/geography/countries-source.json', import.meta.url),
  JSON.stringify(source, null, 2) + '\n',
);
