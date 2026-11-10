import { readFile, writeFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';

const local = new URL('../../../../.local/linuxdo/', import.meta.url);
const data = new URL('../data/', import.meta.url);
const readJson = async (path, directory) =>
  JSON.parse(await readFile(new URL(path, directory), 'utf8'));
const [inventory, evidence, configured, catalog] = await Promise.all([
  readJson('station-inventory.json', local),
  readJson('source-evidence.json', data),
  readJson('streams.json', data),
  readJson('catalog.json', data),
]);
if (
  inventory.version !== catalog.manifest.version ||
  inventory.restrictionsRevision !== catalog.manifest.restrictionsRevision
) {
  throw new Error('音源统计与包内目录版本不同，请重新扫描');
}

const configuredById = new Map(configured.map((stream) => [stream.stationId, stream]));
const channels = evidence.allowed.flatMap(({ operator, permission, catalogOrigin, channels }) =>
  channels.map(({ name, catalogAddresses, url }) => ({
    operator,
    permission,
    name,
    url,
    catalogUrls: catalogAddresses.map((address) => new URL(address, catalogOrigin).href),
    matches: [],
  })),
);
const byCatalogUrl = new Map();
for (const channel of channels) {
  for (const url of channel.catalogUrls) {
    if (byCatalogUrl.has(url)) throw new Error('同一个目录地址关联了多个运营方频道');
    byCatalogUrl.set(url, channel);
  }
}

const counts = {};
const formats = {};
const mp3Urls = new Set();
const ambiguousIds = new Set();
const providerReview = evidence.reviewGroups.map((group) => ({ ...group, stationCount: 0 }));
let directMp3Stations = 0;
const restrictions = {};
const increment = (map, key) => {
  map[key] = (map[key] ?? 0) + 1;
};
const hostRule = (host, domain) => host === domain || host.endsWith(`.${domain}`);
for (const station of inventory.stations) {
  if (station.availability !== 'available' || !station.streams.length) {
    increment(counts, 'noSource');
    continue;
  }
  for (const format of new Set(
    station.streams.map(({ hls, codec }) => (hls ? 'HLS' : (codec ?? 'UNKNOWN'))),
  )) {
    increment(formats, format);
  }
  const mp3 = station.streams.filter(({ hls, codec, url }) => !hls && codec === 'MP3' && url);
  if (mp3.length) {
    directMp3Stations++;
    for (const { url } of mp3) mp3Urls.add(new URL(url).href);
    for (const group of providerReview) {
      if (mp3.some(({ host }) => hostRule(host, group.domain))) group.stationCount++;
    }
  }
  const matched = new Set();
  for (const { url } of station.streams) {
    const channel = byCatalogUrl.get(url);
    if (!channel || matched.has(channel)) continue;
    channel.matches.push({ id: station.id, name: station.name, catalogUrl: url });
    matched.add(channel);
  }
  if (matched.size > 1) ambiguousIds.add(station.id);
  if (matched.size) continue;
  const restricted = evidence.restricted.filter(({ domain }) =>
    station.streams.some(({ host }) => hostRule(host, domain)),
  );
  for (const { operator } of restricted) increment(restrictions, operator);
  if (
    station.streams.every(({ host }) => restricted.some(({ domain }) => hostRule(host, domain)))
  ) {
    increment(counts, 'operatorRestricts');
  } else if (mp3.length) increment(counts, 'mp3NeedsEvidence');
  else if (station.streams.some(({ hls, codec }) => !hls && codec === 'MP3'))
    increment(counts, 'mp3AddressExcluded');
  else if (station.streams.some(({ codec, hls }) => hls || (codec && codec !== 'UNKNOWN')))
    increment(counts, 'otherFormatNeedsEvidence');
  else increment(counts, 'unknownFormatNeedsEvidence');
}

async function probe(url) {
  const address = new URL(url);
  if (address.protocol !== 'https:' || address.username || address.password || address.hash) {
    throw new Error('预检仅接受已审阅的无凭据 HTTPS 音源');
  }
  try {
    const response = await fetch(address, {
      credentials: 'omit',
      redirect: 'manual',
      signal: AbortSignal.timeout(12000),
      headers: { Origin: 'https://linux.do' },
    });
    const mime = response.headers.get('content-type')?.split(';')[0]?.toLowerCase();
    const cors = response.headers.get('access-control-allow-origin');
    try {
      if (response.status >= 300 && response.status < 400) return 'redirect';
      if (response.status !== 200) return `http-${response.status}`;
      if (cors !== '*' && cors !== 'https://linux.do') return 'cors';
      if (mime !== 'audio/mpeg') return 'not-mp3';
      const reader = response.body?.getReader();
      if (!reader) return 'empty';
      try {
        const result = await reader.read();
        return result.value?.length ? 'mp3-bytes' : 'empty';
      } finally {
        await reader.cancel();
      }
    } finally {
      if (!response.body?.locked) await response.body?.cancel();
    }
  } catch (error) {
    return error.name === 'TimeoutError' ? 'timeout' : 'connection';
  }
}

const probes = new Map();
const candidates = [];
const formalAliases = new Map();
const channelsReport = [];
const selectedIds = new Set();
const coveredIds = new Set();
const usedUrls = new Set();
for (const { matches, ...channel } of channels) {
  if (!matches.length) continue;
  const { url, name, operator, permission, catalogUrls } = channel;
  // Prefer an existing approved record, then the operator's first reviewed catalog address.
  const selected = matches.toSorted(
    (a, b) =>
      Number(configuredById.has(b.id)) - Number(configuredById.has(a.id)) ||
      catalogUrls.indexOf(a.catalogUrl) - catalogUrls.indexOf(b.catalogUrl) ||
      a.id.localeCompare(b.id),
  )[0];
  for (const { id } of matches) coveredIds.add(id);
  const existing = configuredById.get(selected.id);
  const aliases = matches
    .filter(({ id }) => id !== selected.id && !configuredById.has(id) && !ambiguousIds.has(id))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(({ id, catalogUrl }) => ({ stationId: id, catalogUrl }));
  if (!probes.has(url)) probes.set(url, await probe(url));
  const access = probes.get(url);
  let status = 'access-blocked';
  const released =
    existing?.url === url && (existing.verification || existing.releaseWithoutSandbox);
  if (released) {
    status = existing.verification ? 'formal' : 'formal-unverified';
    formalAliases.set(selected.id, aliases);
  } else if (usedUrls.has(url) || selectedIds.has(selected.id)) status = 'duplicate';
  else if (access === 'mp3-bytes') {
    status = 'sandbox';
    candidates.push({
      stationId: selected.id,
      catalogUrl: selected.catalogUrl,
      aliases,
      url,
      operator,
      permission,
      verification: null,
    });
  }
  if (released || status === 'sandbox') {
    selectedIds.add(selected.id);
    usedUrls.add(url);
  }
  channelsReport.push({
    operator,
    name,
    status,
    access,
    station: selected.name,
    stationId: selected.id,
    aliases: aliases.length,
  });
}

// Illustrate the size of a hypothetical manifest, without declaring or probing these addresses.
const endpoints = Object.fromEntries(
  [...mp3Urls].map((url, index) => [`station-${index}`, { url, method: 'GET', auth: 'none' }]),
);
const hypothetical = JSON.stringify({ endpoints });
const report = {
  version: inventory.version,
  scannedAt: inventory.scannedAt,
  scenePlayableCount: inventory.scenePlayableCount,
  websitePlayable: inventory.stations.length,
  formats,
  distinctPublicMp3Addresses: mp3Urls.size,
  stationsWithPublicMp3Address: directMp3Stations,
  hypotheticalManifestBytes: Buffer.byteLength(hypothetical),
  hypotheticalManifestCompressedBytes: deflateRawSync(hypothetical).length,
  restrictions,
  providerReview,
  classifications: { ...counts, reviewedCatalogMatches: coveredIds.size },
  channels: channelsReport,
};
await writeFile(new URL('source-report.json', local), JSON.stringify(report, null, 2) + '\n', {
  mode: 0o600,
});
if (process.argv.includes('--write-candidates')) {
  await writeFile(
    new URL('sandbox-streams.json', data),
    JSON.stringify(candidates, null, 2) + '\n',
  );
}
if (process.argv.includes('--write-aliases')) {
  const withAliases = configured.map((source) =>
    formalAliases.has(source.stationId)
      ? { ...source, aliases: formalAliases.get(source.stationId) }
      : source,
  );
  await writeFile(new URL('streams.json', data), JSON.stringify(withAliases, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
