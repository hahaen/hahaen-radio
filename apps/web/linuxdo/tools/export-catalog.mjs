import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CatalogChunkSchema,
  MAX_SCENE_STATIONS,
  SceneChunkSchema,
  SceneManifestSchema,
} from '@haen/contracts';
import { snapshotSchema } from '../schemas.ts';

const api = 'https://hahaen.xyz/radio/api/v1';
const maxBytes = 2 * 1024 * 1024;
const controller = new AbortController();

async function read(path, schema) {
  const response = await fetch(`${api}${path}`, {
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
    redirect: 'error',
    credentials: 'omit',
    headers: { accept: 'application/json' },
  });
  if (!response.ok || !response.body) throw new Error(`公开目录返回 HTTP ${response.status}`);
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('公开目录分片超过读取上限');
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return schema.parse(JSON.parse(Buffer.concat(parts).toString('utf8')));
}

const manifest = await read('/catalog/scene', SceneManifestSchema);
const { version, restrictionsRevision, chunks, stationCount } = manifest;
if (
  stationCount === 0 ||
  stationCount > MAX_SCENE_STATIONS ||
  chunks.some(({ index, count }, position) => index !== position || count < 1 || count > 1000) ||
  chunks.reduce((total, part) => total + part.count, 0) !== stationCount
) {
  throw new Error('公开目录清单不完整');
}

const parts = new Array(chunks.length);
const timezones = new Array(chunks.length);
let next = 0;
async function readChunks() {
  while (next < chunks.length) {
    const { index, count } = chunks[next++];
    const [chunk, summaries] = await Promise.all([
      read(`/catalog/scene/${version}/chunks/${index}`, SceneChunkSchema),
      read(`/catalog/${version}/chunks/${index}`, CatalogChunkSchema),
    ]);
    if (
      chunk.version !== version ||
      chunk.index !== index ||
      chunk.restrictionsRevision !== restrictionsRevision ||
      chunk.entries.length !== count ||
      summaries.version !== version ||
      summaries.index !== index ||
      summaries.items.length !== count ||
      summaries.items.some(({ id }, offset) => id !== chunk.entries[offset][0])
    ) {
      throw new Error('目录版本、限制或分片条数发生变化，请重试导出');
    }
    parts[index] = chunk.entries;
    timezones[index] = summaries.items.flatMap(({ id, timezone, timezoneSource }) =>
      timezone && timezoneSource === 'geonames' ? [[id, timezone]] : [],
    );
  }
}
const pending = Array.from({ length: Math.min(4, chunks.length) }, readChunks);
try {
  await Promise.all(pending);
} catch (error) {
  controller.abort();
  await Promise.allSettled(pending);
  throw error;
}
const current = await read('/catalog/scene', SceneManifestSchema);
if (current.version !== version || current.restrictionsRevision !== restrictionsRevision) {
  throw new Error('公开目录在导出期间更新，请重新导出');
}

const snapshot = snapshotSchema.parse({
  manifest,
  exportedAt: new Date().toISOString(),
  stations: parts.flat(),
  timezones: Object.fromEntries(timezones.flat()),
});
const { stations, ...metadata } = snapshot;
const content = `${JSON.stringify(metadata).slice(0, -1)},\n"stations":[\n${stations.map((station) => JSON.stringify(station)).join(',\n')}\n]}\n`;
if (Buffer.byteLength(content) > 32 * 1024 * 1024) throw new Error('快照超过微应用单文件大小上限');
const target = fileURLToPath(new URL('../data/', import.meta.url));
const temporary = await mkdtemp(join(target, '.export-'));
try {
  const file = join(temporary, 'catalog.json');
  await writeFile(file, content, { flag: 'wx' });
  await rename(file, join(target, 'catalog.json'));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
console.log(`已导出公开目录 ${version}，${stationCount} 条，${snapshot.exportedAt}`);
