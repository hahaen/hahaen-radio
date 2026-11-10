import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { z } from 'zod';
import { snapshotSchema, streamIndexSchema } from '../src/schemas.ts';

const check = process.argv.includes('--check');
const sandbox = process.argv.includes('--sandbox');
const write = check || process.argv.includes('--write');
const uuidV7 = /^[a-f\d]{8}-[a-f\d]{4}-7[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const checkId = '019a2a58-0000-7000-8000-000000000001';
let id = checkId;
if (!check) {
  const input = await readFile('.env.local', 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  id = parseEnv(input).MINI_APP_ID?.trim() ?? '';
  if (!uuidV7.test(id) || id === checkId) {
    throw new Error('请在 apps/ldWeb/.env.local 填写 LINUX DO 分配的 MINI_APP_ID（UUIDv7）。');
  }
}

const httpsUrl = z.url({ protocol: /^https$/ }).refine((value) => {
  const url = new URL(value);
  const privateParameter = [...url.searchParams.keys()].some((key) =>
    /(?:token|password|secret|api[_-]?key|auth|session|signature)/i.test(key),
  );
  return !url.username && !url.password && !url.hash && !privateParameter;
});
const streamConfig = z.array(
  z.strictObject({
    stationId: z.uuid(),
    url: httpsUrl,
    operator: z.string().min(1),
    permission: httpsUrl,
    verification: z
      .strictObject({
        date: z.iso.date(),
        desktop: z.string().min(1),
        mobile: z.string().min(1),
      })
      .nullable(),
  }),
);

if (write) {
  const { pack } = await import('../../../.local/ldweb/sdk/pack.mjs');
  const version = JSON.parse(await readFile('package.json', 'utf8')).version;
  const catalog = await readFile('data/catalog.json');
  const snapshot = snapshotSchema.parse(JSON.parse(catalog.toString('utf8')));
  const stations = new Map(snapshot.stations.map((station) => [station[0], station]));
  const configured = streamConfig.parse(JSON.parse(await readFile('data/streams.json', 'utf8')));
  const ids = new Set();
  for (const { stationId } of configured) {
    const station = stations.get(stationId);
    if (!station || station[12] === 'blocked' || ids.has(stationId)) {
      throw new Error(`直播源关联的目录记录无效：${stationId}`);
    }
    ids.add(stationId);
  }
  const streams = check ? [] : configured.filter(({ verification }) => sandbox || verification);
  if (!check && !sandbox && !streams.length) {
    throw new Error('正式包需要至少一条已通过桌面和手机沙箱验收的直播源。');
  }
  const entries = streamIndexSchema.parse(
    streams.map(({ stationId, verification }) => ({
      stationId,
      endpoint: `station-${stationId}`,
      candidate: !verification,
    })),
  );
  const endpoints = Object.fromEntries(
    entries.map(({ endpoint }, index) => [
      endpoint,
      {
        url: streams[index].url,
        method: 'GET',
        auth: 'none',
      },
    ]),
  );
  const manifest = {
    format: 1,
    id,
    version,
    name: '声屿 HAEN',
    entry: 'index.html',
    script: 'app.js',
    style: 'app.css',
    permissions: [
      'storage.read',
      'storage.write',
      ...(streams.length ? ['network.request', 'audio.webAudio'] : []),
    ],
    assets: ['data/catalog.json', 'data/streams.json', 'data/land.json'],
    ...(streams.length ? { endpoints } : {}),
  };
  const files = {
    'index.html': await readFile('src/template.html'),
    'app.js': await readFile('dist/web/app.js'),
    'app.css': await readFile('dist/web/app.css'),
    'strings.json': await readFile('src/strings.json'),
    'data/catalog.json': catalog,
    'data/streams.json': JSON.stringify(entries),
    'data/land.json': await readFile('../web/public/geography/land.json'),
  };
  const folder = check ? 'check' : sandbox ? 'sandbox' : 'package';
  const result = await pack({ manifest, files, outputDirectory: `dist/${folder}` });
  console.log(
    `${check ? '仅供本地核验' : sandbox ? '沙箱验证包' : '正式候选包'} ${result.file} (${result.size} bytes)，${snapshot.stationCount} 条目录，${streams.length} 条直播源`,
  );
}
