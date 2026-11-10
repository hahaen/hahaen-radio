import { mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { decodeSceneEntry } from '@haen/contracts';
import { z } from 'zod';
import { packSnapshot, snapshotSchema, streamIndexSchema } from '../schemas.ts';

const check = process.argv.includes('--check');
const sandbox = process.argv.includes('--sandbox');
const write = check || process.argv.includes('--write');
const uuidV7 = /^[a-f\d]{8}-[a-f\d]{4}-7[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const checkId = '019a2a58-0000-7000-8000-000000000001';
const maxUploadKiB = 4096;
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
  const host = url.hostname.replace(/\.$/, '');
  return (
    !url.username &&
    !url.password &&
    !url.hash &&
    !privateParameter &&
    host !== 'hahaen.xyz' &&
    !host.endsWith('.hahaen.xyz')
  );
});
const streamConfig = z.array(
  z.strictObject({
    stationId: z.uuid(),
    catalogUrl: httpsUrl,
    aliases: z.array(z.strictObject({ stationId: z.uuid(), catalogUrl: httpsUrl })).default([]),
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
  const { version } = JSON.parse(
    await readFile(new URL('../version.json', import.meta.url), 'utf8'),
  );
  const snapshot = snapshotSchema.parse(JSON.parse(await readFile('data/catalog.json', 'utf8')));
  const available = new Set(
    snapshot.stations
      .map(decodeSceneEntry)
      .filter(({ availability }) => availability === 'available')
      .map(({ id }) => id),
  );
  const configured = streamConfig.parse(JSON.parse(await readFile('data/streams.json', 'utf8')));
  const ids = new Set();
  function registerStationIds({ stationId, aliases }) {
    for (const id of [stationId, ...aliases.map((alias) => alias.stationId)]) {
      if (ids.has(id)) throw new Error(`直播源重复关联同一电台：${id}`);
      ids.add(id);
    }
  }
  for (const source of configured) registerStationIds(source);
  if (check || sandbox) {
    const candidates = streamConfig.parse(
      JSON.parse(await readFile('data/sandbox-streams.json', 'utf8')),
    );
    const offset = Number(process.env.HAEN_LINUXDO_SANDBOX_OFFSET ?? 0);
    const limit = Number(process.env.HAEN_LINUXDO_SANDBOX_LIMIT ?? 100);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) {
      throw new Error('沙箱候选批次必须使用有效的起始位置和条数');
    }
    for (const source of candidates.slice(offset, offset + limit)) {
      if (ids.has(source.stationId)) continue;
      registerStationIds(source);
      configured.push({ ...source, verification: null });
    }
  }
  const endpointByUrl = new Map();
  const entries = streamIndexSchema.parse(
    configured.flatMap(({ stationId, aliases, url, verification }) => {
      if (!check && !sandbox && !verification) return [];
      const stationIds = [stationId, ...aliases.map((alias) => alias.stationId)].filter((id) =>
        available.has(id),
      );
      if (!stationIds.length) return [];
      if (!endpointByUrl.has(url)) endpointByUrl.set(url, `station-${stationId}`);
      const endpoint = endpointByUrl.get(url);
      return stationIds.map((id) => ({ stationId: id, endpoint, candidate: !verification }));
    }),
  );
  if (!check && !sandbox && !entries.length) {
    throw new Error('正式包需要至少一条已通过桌面和手机沙箱验收的直播源。');
  }
  const streamEndpoints = Object.fromEntries(
    [...endpointByUrl].map(([url, endpoint]) => [endpoint, { url, method: 'GET', auth: 'none' }]),
  );
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
      ...(entries.length ? ['network.request', 'audio.webAudio'] : []),
    ],
    assets: [
      'data/catalog.json',
      'data/streams.json',
      ...geography.map((name) => 'geography/' + name),
    ],
    ...(entries.length ? { endpoints: streamEndpoints } : {}),
  };
  const files = {
    'index.html': await readFile('template.html'),
    'app.js': await readFile('dist/bundle/app.js'),
    'app.css': await readFile('dist/bundle/app.css'),
    'strings.json': await readFile('strings.json'),
    'data/catalog.json': JSON.stringify(packSnapshot(snapshot)),
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
  const outputDirectory = `dist/${folder}`;
  const temporary = await mkdtemp('dist/.linuxdo-package-');
  try {
    const result = await pack({ manifest, files, outputDirectory: temporary });
    const sizeKiB = (result.size / 1024).toFixed(2);
    if (result.size > maxUploadKiB * 1024) {
      throw new Error(`微应用 ZIP 为 ${sizeKiB} KiB，超过 ${maxUploadKiB} KiB 上传上限。`);
    }
    await mkdir(outputDirectory, { recursive: true });
    await rename(`${temporary}/package.json`, `${outputDirectory}/package.json`);
    await rename(result.file, `${outputDirectory}/app.zip`);
    console.log(
      `${check ? '仅供本地核验' : sandbox ? '沙箱验证包' : '正式候选包'} ${version} ${outputDirectory}/app.zip (${sizeKiB} KiB)，${snapshot.manifest.stationCount} 条包内电台，${entries.length} 条可播记录，${endpointByUrl.size} 个直播端点`,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
