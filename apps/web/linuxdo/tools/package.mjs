import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { z } from 'zod';
import { streamIndexSchema } from '../schemas.ts';

const check = process.argv.includes('--check');
const sandbox = process.argv.includes('--sandbox');
const write = check || process.argv.includes('--write');
const uuidV7 = /^[a-f\d]{8}-[a-f\d]{4}-7[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const checkId = '019a2a58-0000-7000-8000-000000000001';
let id = checkId;
if (!check) {
  const config = new URL('../../../../.env.local.linuxdo', import.meta.url);
  const input = await readFile(config, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  id = parseEnv(input).MINI_APP_ID?.trim() ?? '';
  if (!uuidV7.test(id) || id === checkId) {
    throw new Error(
      '请在仓库根目录的 .env.local.linuxdo 填写 LINUX DO 分配的 MINI_APP_ID（UUIDv7）。',
    );
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
    catalogUrl: httpsUrl,
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
  const { pack } = await import('../../../../.local/linuxdo/sdk/pack.mjs');
  const version = JSON.parse(await readFile('../package.json', 'utf8')).version;
  const configured = streamConfig.parse(JSON.parse(await readFile('data/streams.json', 'utf8')));
  const ids = new Set();
  for (const { stationId } of configured) {
    if (ids.has(stationId)) throw new Error(`直播源重复关联同一电台：${stationId}`);
    ids.add(stationId);
  }
  const streams = configured.filter(({ verification }) => check || sandbox || verification);
  if (!check && !sandbox && !streams.length) {
    throw new Error('正式包需要至少一条已通过桌面和手机沙箱验收的直播源。');
  }
  const entries = streamIndexSchema.parse(
    streams.map(({ stationId, catalogUrl, verification }) => ({
      stationId,
      catalogUrl,
      endpoint: `station-${stationId}`,
      candidate: !verification,
    })),
  );
  const streamEndpoints = Object.fromEntries(
    entries.map(({ endpoint }, index) => [
      endpoint,
      {
        url: streams[index].url,
        method: 'GET',
        auth: 'none',
      },
    ]),
  );
  const apiBase = 'https://hahaen.xyz/radio/api/v1/linuxdo';
  const endpoints = {
    'radio-scene': { url: `${apiBase}/scene`, method: 'GET', auth: 'none' },
    'radio-chunk': {
      url: `${apiBase}/chunk`,
      method: 'GET',
      auth: 'none',
      query: ['version', 'index'],
    },
    'radio-stations': { url: `${apiBase}/stations`, method: 'GET', auth: 'none', query: ['ids'] },
    ...streamEndpoints,
  };
  const geography = ['land.json', 'regions.json', 'relief.jpg', 'world.svg'];
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
      'network.request',
      ...(streams.length ? ['audio.webAudio'] : []),
    ],
    assets: ['data/streams.json', ...geography.map((name) => 'geography/' + name)],
    endpoints,
  };
  const files = {
    'index.html': await readFile('template.html'),
    'app.js': await readFile('dist/bundle/app.js'),
    'app.css': await readFile('dist/bundle/app.css'),
    'strings.json': await readFile('strings.json'),
    'data/streams.json': JSON.stringify(entries),
    ...Object.fromEntries(
      await Promise.all(
        geography.map(async (name) => [
          'geography/' + name,
          await readFile('../public/geography/' + name),
        ]),
      ),
    ),
  };
  const folder = check ? 'check' : sandbox ? 'sandbox' : 'package';
  const result = await pack({ manifest, files, outputDirectory: `dist/${folder}` });
  console.log(
    `${check ? '仅供本地核验' : sandbox ? '沙箱验证包' : '正式候选包'} ${result.file} (${result.size} bytes)，目录由 radio-api 提供，${streams.length} 条直播源`,
  );
}
