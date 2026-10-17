import { readFile, readdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const root = new URL('../apps/web/dist/', import.meta.url);
const assets = [];
async function collect(directory = '') {
  for (const entry of await readdir(new URL(directory, root), { withFileTypes: true })) {
    const file = directory + entry.name;
    if (entry.isSymbolicLink()) throw new Error('Symlink in production artifact');
    if (entry.isDirectory()) {
      await collect(file + '/');
      continue;
    }
    if (!/\.(js|css|woff2?|ttf|otf|json|svg)$/.test(entry.name)) continue;
    const data = await readFile(new URL(file, root));
    assets.push({
      file,
      bytes: data.length,
      gzip: gzipSync(data).length,
      sha256: createHash('sha256').update(data).digest('hex'),
    });
  }
}
await collect();
assets.sort((a, b) => a.file.localeCompare(b.file));
const sum = (pattern, field) =>
  assets
    .filter((asset) => pattern.test(asset.file))
    .reduce((total, asset) => total + asset[field], 0);
const entry = assets.filter((asset) => /^assets\/index-.*\.js$/.test(asset.file));
if (entry.length !== 1) throw new Error('Expected one application entry bundle');
for (const file of [
  'geography/land.json',
  'geography/world.svg',
  'fonts/noto-sans-sc-ui.woff2',
  'fonts/noto-serif-sc-ui.woff2',
  'fonts/ibm-plex-mono-ui.woff2',
])
  if (!assets.some((asset) => asset.file === file && asset.bytes > 0))
    throw new Error('Required artifact missing: ' + file);
if (!assets.some((asset) => /\.css$/.test(asset.file) && asset.bytes > 0))
  throw new Error('Missing CSS artifact');
const checks = [
  { name: 'entryGzip', actual: entry[0].gzip, limit: 220 * 1024 },
  { name: 'allJavaScriptGzip', actual: sum(/\.js$/, 'gzip'), limit: 600 * 1024 },
  { name: 'allCssGzip', actual: sum(/\.css$/, 'gzip'), limit: 50 * 1024 },
  { name: 'fontsRaw', actual: sum(/\.(woff2?|ttf|otf)$/, 'bytes'), limit: 512 * 1024 },
  {
    name: 'geographyRaw',
    actual: sum(/^geography\/(land\.json|world\.svg)$/, 'bytes'),
    limit: 1024 * 1024,
  },
];
console.log(JSON.stringify({ schema: 1, units: 'bytes', assets, checks }, null, 2));
if (checks.some((check) => check.actual > check.limit)) process.exitCode = 1;
