import { getSDK } from '@discourse-mini-app/sdk';
import type { StationDetail, StationPreview } from '@haen/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { App } from '../src/app/App';
import type { LocalPlatform } from '../src/app/local-platform';
import { configurePackagedMapAssets } from '../src/graphics/map-assets';
import { applyLanguage } from '../src/locales/i18n';
import { createCatalog } from './catalog';
import { createEngine } from './engine';
import { streamIndexSchema } from './schemas';
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
  const catalog = createCatalog(sdk);
  const [sources, storage, world] = await Promise.all([
    sdk.assets
      .readJson('data/streams.json', { timeoutMs: 10000 })
      .then((raw) => streamIndexSchema.parse(raw)),
    loadStorage(sdk, async (ids) => (await catalog.lookup(ids, AbortSignal.timeout(15000))).items),
    sdk.assets.readBytes('geography/world.svg', { timeoutMs: 10000 }).catch(() => undefined),
  ]);
  const streams = new Map(sources.map((source) => [source.stationId, source]));
  const sourceFor = (id: string, candidates: StationDetail['streams']) => {
    const source = streams.get(id);
    return source && candidates.some(({ url }) => url === source.catalogUrl) ? source : undefined;
  };
  const canPlay = (station: StationPreview, detail?: StationDetail | null) =>
    station.availability === 'available' &&
    sdk.permissions.has('network.request') &&
    sdk.permissions.has('audio.webAudio') &&
    (detail?.id === station.id ? !!sourceFor(station.id, detail.streams) : streams.has(station.id));
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
  const local: LocalPlatform = {
    ...catalog,
    player: {
      explicitPlayback: true,
      createEngine: () =>
        createEngine(sdk, (id, candidates) => sourceFor(id, candidates)?.endpoint),
      station: catalog.station,
      isPlayable: (detail) => canPlay(detail, detail),
    },
    canPlay,
    isCandidate: (id) => streams.get(id)?.candidate === true,
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
  root.render(<p role="alert">声屿 HAEN 未能启动，请重新打开微应用。</p>);
});
