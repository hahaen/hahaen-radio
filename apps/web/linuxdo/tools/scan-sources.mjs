import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import {
  GenreSchema,
  SceneManifestSchema,
  StationLookupResultSchema,
  StationPageSchema,
} from '@haen/contracts';
import { snapshotSchema } from '../schemas.ts';

const api = 'https://hahaen.xyz/radio/api/v1';
const output = new URL('../../../../.local/linuxdo/', import.meta.url);
const snapshot = snapshotSchema.parse(
  JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url), 'utf8')),
);
const genres = GenreSchema.options.filter((genre) => genre !== 'religious');
const ids = snapshot.stations
  .filter((entry) => entry[12] === 'available' && genres.includes(entry[9]))
  .map(([id]) => id);
const signal = new AbortController();

async function read(path, schema, body) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(api + path, {
        signal: AbortSignal.any([signal.signal, AbortSignal.timeout(20000)]),
        credentials: 'omit',
        redirect: 'error',
        headers: {
          accept: 'application/json',
          ...(body && { 'content-type': 'application/json' }),
        },
        ...(body && { method: 'POST', body: JSON.stringify(body) }),
      });
      if (response.ok) return schema.parse(await response.json());
      await response.body?.cancel();
      if (response.status !== 429 && response.status < 500) {
        throw new Error(`公开目录请求失败 (${response.status})`, { cause: 'permanent' });
      }
      throw new Error(`公开目录暂不可用 (${response.status})`);
    } catch (error) {
      if (error.cause === 'permanent' || signal.signal.aborted || attempt >= 3) throw error;
      await setTimeout(1500 * 2 ** attempt, undefined, { signal: signal.signal });
    }
  }
}

async function confirmSnapshot() {
  const live = await read('/catalog/scene', SceneManifestSchema);
  if (
    live.version !== snapshot.manifest.version ||
    live.restrictionsRevision !== snapshot.manifest.restrictionsRevision
  ) {
    throw new Error('包内目录与线上不同，请先导出最新公开目录再统计');
  }
  const search = await read(
    `/stations?playableOnly=true&genres=${genres.join(',')}&limit=1`,
    StationPageSchema,
  );
  if (search.total !== ids.length) throw new Error('包内可播范围与官网搜索结果不一致');
  return live;
}

const live = await confirmSnapshot();
const batchSize = 100;
const batches = Math.ceil(ids.length / batchSize);
const results = new Array(batches);
let next = 0;
let completed = 0;
function inventoryStream({ url, hls, codec }) {
  const address = new URL(url);
  const unsafe =
    address.username ||
    address.password ||
    address.hash ||
    [...address.searchParams.keys()].some((key) =>
      /token|password|secret|api[_-]?key|auth|session|signature|key|expires/i.test(key),
    );
  return { url: unsafe ? null : url, host: address.hostname, hls, codec };
}

async function worker() {
  while (next < batches) {
    const index = next++;
    const batch = ids.slice(index * batchSize, (index + 1) * batchSize);
    const result = await read('/stations/lookup', StationLookupResultSchema, { ids: batch });
    const returned = [...result.items.map(({ id }) => id), ...result.missing];
    if (
      new Set(returned).size !== batch.length ||
      returned.length !== batch.length ||
      returned.some((id) => !batch.includes(id))
    ) {
      throw new Error('官网电台批量查询结果不完整');
    }
    results[index] = [
      ...result.items.map(({ id, name, availability, streams }) => ({
        id,
        name,
        availability,
        streams: streams.map(inventoryStream),
      })),
      ...result.missing.map((id) => ({ id, availability: 'missing', streams: [] })),
    ];
    if (++completed % 50 === 0) console.log(`已读取 ${completed}/${batches} 批公开电台详情`);
    await setTimeout(100, undefined, { signal: signal.signal });
  }
}

const workers = Array.from({ length: 4 }, worker);
try {
  await Promise.all(workers);
} catch (error) {
  signal.abort();
  await Promise.allSettled(workers);
  throw error;
}
await confirmSnapshot();
await mkdir(output, { recursive: true, mode: 0o700 });
const target = new URL('station-inventory.json', output);
const temp = new URL(`.station-inventory-${process.pid}.json`, output);
await writeFile(
  temp,
  JSON.stringify({
    version: live.version,
    restrictionsRevision: live.restrictionsRevision,
    scannedAt: new Date().toISOString(),
    scenePlayableCount: live.playableCount,
    stations: results.flat(),
  }),
  { flag: 'wx', mode: 0o600 },
);
await rename(temp, target);
console.log(`已扫描官网可播目录 ${ids.length} 台：${fileURLToPath(target)}`);
