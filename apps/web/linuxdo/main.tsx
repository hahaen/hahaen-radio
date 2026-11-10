import { getSDK } from '@discourse-mini-app/sdk';
import { decodeSceneEntry, normalizeLanguages, type StationDetail } from '@haen/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { App } from '../src/app/App';
import type { LocalPlatform } from '../src/app/local-platform';
import { configurePackagedMapAssets } from '../src/graphics/map-assets';
import { applyLanguage } from '../src/locales/i18n';
import { HttpError } from '../src/services/http';
import { createEngine } from './engine';
import { snapshotSchema, streamIndexSchema } from './schemas';
import { loadStorage } from './storage';
import '../src/styles/global.css';

const brand = '声屿 HAEN';
const element = document.getElementById('root');
if (!element) throw new Error('Missing application root');
const root = createRoot(element);

async function start() {
  const sdk = getSDK();
  await sdk.ready;
  await sdk.lifecycle.ready();
  const [snapshot, sources] = await Promise.all([
    sdk.assets
      .readJson('data/catalog.json', { timeoutMs: 30000 })
      .then((raw) => snapshotSchema.parse(raw)),
    sdk.assets
      .readJson('data/streams.json', { timeoutMs: 10000 })
      .then((raw) => streamIndexSchema.parse(raw)),
  ]);
  const stations = snapshot.stations.map(decodeSceneEntry);
  const byId = new Map(stations.map((station) => [station.id, station]));
  const streams = new Map(sources.map((source) => [source.stationId, source]));
  const canPlay = (id: string) =>
    streams.has(id) &&
    byId.get(id)?.availability !== 'blocked' &&
    sdk.permissions.has('network.request') &&
    sdk.permissions.has('audio.webAudio');
  const find = (id: string): StationDetail | undefined => {
    const station = byId.get(id);
    return (
      station && {
        ...station,
        tags: [],
        timezone: null,
        timezoneSource: null,
        homepage: null,
        streams: [],
      }
    );
  };
  const [storage, world] = await Promise.all([
    loadStorage(sdk, find),
    sdk.assets.readBytes('geography/world.svg', { timeoutMs: 10000 }).catch(() => undefined),
  ]);
  const fallback = world ? URL.createObjectURL(new Blob([world], { type: 'image/svg+xml' })) : '';
  if (fallback)
    window.addEventListener('pagehide', () => URL.revokeObjectURL(fallback), { once: true });
  configurePackagedMapAssets(
    (path, signal) => sdk.assets.readBytes(path, signal ? { signal } : {}),
    fallback,
  );
  await applyLanguage(
    storage.language ?? (navigator.language.startsWith('en') ? 'en' : 'zh'),
    brand,
  );

  const genres = new Map<StationDetail['genre'], number>();
  const languages = new Map<string, number>();
  const countries = new Set<string>();
  for (const station of stations) {
    if (station.countryCode) countries.add(station.countryCode);
    genres.set(station.genre, (genres.get(station.genre) ?? 0) + 1);
    for (const id of normalizeLanguages(station.languages))
      languages.set(id, (languages.get(id) ?? 0) + 1);
  }
  const local: LocalPlatform = {
    catalog: {
      stale: false,
      stations,
      manifest: {
        format: snapshot.format,
        version: snapshot.version,
        restrictionsRevision: snapshot.restrictionsRevision,
        createdAt: snapshot.exportedAt,
        stationCount: snapshot.stationCount,
        countryCount: countries.size,
        playableCount: [...streams.keys()].filter(canPlay).length,
        genres: [...genres].map(([id, count]) => ({ id, count })),
        languages: [...languages].map(([id, count]) => ({ id, count })),
        chunks: [],
      },
    },
    player: {
      explicitPlayback: true,
      createEngine: () =>
        createEngine(sdk, (id) => (canPlay(id) ? streams.get(id)?.endpoint : undefined)),
      async station(id, signal) {
        signal.throwIfAborted();
        const result = find(id);
        if (!result) throw new HttpError(404, 'NOT_FOUND');
        return result;
      },
      isPlayable: ({ id }) => canPlay(id),
    },
    canPlay,
    isCandidate: (id) => streams.get(id)?.candidate === true,
    lookup(ids) {
      const items: StationDetail[] = [];
      const missing: string[] = [];
      for (const id of ids) {
        const result = find(id);
        if (result) items.push(result);
        else missing.push(id);
      }
      return { items, missing };
    },
    createLibrary: storage.createLibrary,
    async setLanguage(value) {
      await applyLanguage(value, brand);
      return storage.saveLanguage(value);
    },
  };
  root.render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <App local={local} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
void start().catch(() => {
  root.render(<p role="alert">电台目录未能载入，请重新打开声屿 HAEN。</p>);
});
