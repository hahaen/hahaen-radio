import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { snapshotSchema, stationEntry } from '../schemas.ts';

const api = 'https://hahaen.xyz/radio/api/v1';
const maxBytes = 2 * 1024 * 1024;
const manifestSchema = z.object({
  format: z.literal(1),
  version: z.uuid(),
  restrictionsRevision: z.string().regex(/^[a-f\d]{64}$/),
  stationCount: z.number().int().positive().max(200000),
  chunks: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        count: z.number().int().min(1).max(1000),
      }),
    )
    .min(1)
    .max(200),
});
const chunkSchema = manifestSchema
  .pick({ format: true, version: true, restrictionsRevision: true })
  .extend({
    index: z.number().int().nonnegative(),
    entries: z.array(stationEntry).max(1000),
  });
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

const manifest = await read('/catalog/scene', manifestSchema);
const { version, restrictionsRevision, chunks, stationCount } = manifest;
if (
  chunks.some(({ index }, position) => index !== position) ||
  chunks.reduce((total, part) => total + part.count, 0) !== stationCount
) {
  throw new Error('公开目录清单不完整');
}

const parts = new Array(chunks.length);
let next = 0;
async function readChunks() {
  while (next < chunks.length) {
    const { index, count } = chunks[next++];
    const chunk = await read(`/catalog/scene/${version}/chunks/${index}`, chunkSchema);
    if (
      chunk.version !== version ||
      chunk.index !== index ||
      chunk.restrictionsRevision !== restrictionsRevision ||
      chunk.entries.length !== count
    ) {
      throw new Error('目录版本、限制或分片条数发生变化，请重试导出');
    }
    parts[index] = chunk.entries;
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
const current = await read('/catalog/scene', manifestSchema);
if (current.version !== version || current.restrictionsRevision !== restrictionsRevision) {
  throw new Error('公开目录在导出期间更新，请重新导出');
}

const snapshot = snapshotSchema.parse({
  format: 1,
  version,
  restrictionsRevision,
  exportedAt: new Date().toISOString(),
  stationCount,
  stations: parts.flat(),
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
