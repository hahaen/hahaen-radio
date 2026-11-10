import { getSDK, type MiniAppSDK } from '@discourse-mini-app/sdk';
import {
  ArrowDown,
  Compass,
  Globe2,
  Play,
  Radio,
  Search,
  Shuffle,
  Square,
  Star,
} from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { genres, languageName, normalize, toStation, type Station } from './catalog';
import { mountGlobe, type Land, type MapStation } from './globe';
import { createPlayer, type Playback } from './player';
import { snapshotSchema, streamIndexSchema } from './schemas';
import './style.css';

const storageKey = 'haen:ld:favorites:v1';
const pageSize = 36;

function mapPoint(station: Station): MapStation | undefined {
  const { id, latitude, longitude, precision } = station;
  if (precision === 'coordinates' && latitude !== null && longitude !== null)
    return { id, latitude, longitude };
}

function Globe({
  station,
  points,
  land,
  select,
}: {
  station: Station;
  points: MapStation[];
  land: Land;
  select: (id: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const globe = useRef<ReturnType<typeof mountGlobe>>(null);
  useEffect(() => {
    const element = canvas.current!;
    const scene = mountGlobe(element, land, points, select);
    globe.current = scene;
    element.hidden = !scene;
    return () => scene?.close();
  }, [land, points, select]);
  useEffect(() => globe.current?.focus(mapPoint(station)), [station]);
  return (
    <figure className="ld-globe">
      <canvas
        ref={canvas}
        aria-label="电台地球，可拖动或用方向键旋转。也可从目录选台。"
        tabIndex={0}
      />
      <div className="ld-globe-fallback">地图不可用，可以继续从目录选台。</div>
      <figcaption>拖动地球或点选微光</figcaption>
    </figure>
  );
}

type Catalog = Awaited<ReturnType<typeof load>>;
async function load(sdk: MiniAppSDK | null) {
  async function read(path: string): Promise<unknown> {
    if (sdk) return sdk.assets.readJson(path);
    if (import.meta.env.DEV) {
      const response = await fetch(`/${path}`);
      if (response.ok) return response.json();
    }
    throw new Error('Asset unavailable');
  }
  const [rawCatalog, rawStreams, land] = await Promise.all([
    read('data/catalog.json'),
    read('data/streams.json'),
    read('data/land.json'),
  ]);
  const { stations, ...info } = snapshotSchema.parse(rawCatalog);
  const catalog = stations.map(toStation);
  const byId = new Map(catalog.map((station) => [station.id, station]));
  const streams = new Map(
    streamIndexSchema.parse(rawStreams).map((stream) => [stream.stationId, stream]),
  );
  const initialStation =
    catalog.find((station) => streams.has(station.id)) ??
    catalog.find((station) => station.countryCode === 'CN' && station.city && mapPoint(station)) ??
    catalog.find((station) => station.countryCode === 'CN' && mapPoint(station)) ??
    catalog[0]!;
  const cityCounts = new Map<string, number>();
  for (const { cityKey } of catalog) {
    if (cityKey) cityCounts.set(cityKey, (cityCounts.get(cityKey) ?? 0) + 1);
  }
  const points = catalog.flatMap((station) => mapPoint(station) ?? []);
  const languages = [...new Set(catalog.flatMap((station) => station.languages))]
    .map((code) => ({ code, label: languageName(code) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
  return {
    catalog,
    byId,
    streams,
    points,
    languages,
    info,
    land: land as Land,
    initialStation,
    cityCounts,
  };
}

function App({ sdk, data }: { sdk: MiniAppSDK | null; data: Catalog }) {
  const { initialStation } = data;
  const [selectedId, setSelectedId] = useState(initialStation.id);
  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState('');
  const [language, setLanguage] = useState('');
  const [onlySaved, setOnlySaved] = useState(false);
  const [onlyPlayable, setOnlyPlayable] = useState(false);
  const [city, setCity] = useState<{ key: string; name: string }>();
  const [limit, setLimit] = useState(pageSize);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState('');
  const [playback, setPlayback] = useState<Playback>('idle');
  const player = useMemo(() => (sdk ? createPlayer(sdk, setPlayback) : undefined), [sdk]);
  const search = useRef<HTMLInputElement>(null);
  const selection = useRef<HTMLElement>(null);
  const directory = useRef<HTMLElement>(null);
  const writes = useRef(Promise.resolve());
  const station = data.byId.get(selectedId) ?? initialStation;
  const stream = data.streams.get(station.id);
  const saved = favorites.includes(station.id);
  const deferredQuery = useDeferredValue(query);
  const visible = useMemo(() => {
    const words = normalize(deferredQuery).split(/\s+/u).filter(Boolean);
    const savedIds = new Set(favorites);
    return data.catalog.filter(
      (item) =>
        (!genre || item.genre === genre) &&
        (!language || item.languages.includes(language)) &&
        (!onlySaved || savedIds.has(item.id)) &&
        (!onlyPlayable || data.streams.has(item.id)) &&
        (!city || item.cityKey === city.key) &&
        words.every((word) => item.search.includes(word)),
    );
  }, [data, deferredQuery, genre, language, favorites, onlySaved, onlyPlayable, city]);
  const sameCityCount = data.cityCounts.get(station.cityKey) ?? 0;
  const active = playback === 'connecting' || playback === 'playing';

  useEffect(() => {
    let live = true;
    async function initialize() {
      try {
        if (sdk && !sdk.permissions.has('storage.read')) throw new Error('Storage unavailable');
        const raw = sdk
          ? await sdk.localStorage.getItem(storageKey)
          : localStorage.getItem(storageKey);
        const value: unknown = JSON.parse(raw ?? '[]');
        if (live && Array.isArray(value)) {
          setFavorites([
            ...new Set(
              value.filter((id): id is string => typeof id === 'string' && data.byId.has(id)),
            ),
          ]);
        }
      } catch {
        if (live) setNotice('无法读取收藏。');
      } finally {
        if (live) setLoaded(true);
      }
    }
    void initialize();
    return () => {
      live = false;
    };
  }, [data, sdk]);
  useEffect(() => {
    if (!player) return;
    const stop = () => player.stop();
    window.addEventListener('pagehide', stop);
    return () => {
      window.removeEventListener('pagehide', stop);
      stop();
    };
  }, [player]);

  function toggleFavorite() {
    const next = saved ? favorites.filter((id) => id !== station.id) : [...favorites, station.id];
    setFavorites(next);
    setNotice('');
    writes.current = writes.current.then(async () => {
      try {
        const value = JSON.stringify(next);
        if (!sdk) localStorage.setItem(storageKey, value);
        else if (sdk.permissions.has('storage.write'))
          await sdk.localStorage.setItem(storageKey, value);
        else throw new Error('Storage unavailable');
      } catch {
        setNotice('无法保存收藏，此次改动只保留在当前页面。');
      }
    });
  }

  function select(id: string) {
    if (id === selectedId) return;
    player?.stop();
    setSelectedId(id);
  }

  function tuneRandom() {
    const alternatives = visible.filter(({ id }) => id !== station.id);
    if (alternatives.length)
      select(alternatives[Math.floor(Math.random() * alternatives.length)]!.id);
    else if (visible[0]) select(visible[0].id);
  }

  function reset() {
    setQuery('');
    setGenre('');
    setLanguage('');
    setOnlySaved(false);
    setOnlyPlayable(false);
    setCity(undefined);
    setLimit(pageSize);
  }

  // Globe pointer listeners stay attached while selection and playback change.
  const selectRef = useRef(select);
  useEffect(() => {
    selectRef.current = select;
  });
  const selectFromGlobe = useMemo(() => (id: string) => selectRef.current(id), []);
  const playbackNote =
    playback === 'unsupported'
      ? '当前浏览器不支持此直播格式。'
      : playback === 'error'
        ? '无法播放此电台，请重试。'
        : playback === 'connecting'
          ? '正在连接直播…'
          : playback === 'playing'
            ? '直播播放中'
            : stream
              ? '点击播放，在当前页面收听。'
              : '此电台暂未开放站内播放。';

  return (
    <main className="ld-shell">
      <header className="ld-header">
        <div className="ld-brand">
          <span className="ld-logo">
            <Radio size={21} />
          </span>
          <span>
            声屿 <b>HAEN</b>
          </span>
        </div>
        <span className="ld-edition">LINUX DO 微应用</span>
      </header>
      <div className="ld-layout">
        <section className="ld-scene" aria-label="电台地球与当前电台">
          <div className="ld-intro">
            <p className="ld-kicker">
              <Compass size={14} /> 电台地图
            </p>
            <h1>嗯，听听世界。</h1>
          </div>
          <Globe station={station} points={data.points} land={data.land} select={selectFromGlobe} />
          <section className="ld-selection" ref={selection} aria-label="当前电台">
            <p className="ld-meta">
              <span className="ld-signal" /> {station.location}
            </p>
            <h2>{station.name}</h2>
            <p className="ld-description">
              {[
                genres[station.genre],
                ...station.languages.map(languageName),
                station.bitrate ? `${station.bitrate} kbps` : '',
                station.nearbyCity && !station.city ? `附近城市 ${station.nearbyCity}` : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {station.precision === 'coordinates' &&
              station.latitude !== null &&
              station.longitude !== null && (
                <p className="ld-coordinates">
                  {station.latitude.toFixed(2)}°，{station.longitude.toFixed(2)}°
                </p>
              )}
            <div className="ld-actions">
              {stream && player && (
                <button
                  type="button"
                  className="ld-primary"
                  onClick={() => (active ? player.stop() : player.play(stream.endpoint))}
                >
                  {active ? <Square size={16} /> : <Play size={16} />}
                  {active ? '停止播放' : stream.candidate ? '沙箱试播' : '播放直播'}
                </button>
              )}
              <button
                type="button"
                className="ld-icon"
                aria-label="收藏当前电台"
                aria-pressed={saved}
                disabled={!loaded}
                onClick={toggleFavorite}
                title={saved ? '取消收藏' : '收藏电台'}
              >
                <Star size={19} fill={saved ? 'currentColor' : 'none'} />
              </button>
              <button
                type="button"
                className="ld-icon"
                aria-label="随机选台"
                disabled={!visible.length}
                onClick={tuneRandom}
                title="随机选台"
              >
                <Shuffle size={19} />
              </button>
              {sameCityCount > 1 && (
                <button
                  type="button"
                  className="ld-chip"
                  onClick={() => {
                    reset();
                    setCity({ key: station.cityKey, name: station.city! });
                    if (matchMedia('(max-width: 700px)').matches)
                      directory.current?.scrollIntoView({ block: 'start' });
                  }}
                >
                  同城 {sameCityCount}
                </button>
              )}
            </div>
            <p className="ld-notice" role="status">
              {playbackNote}
            </p>
            {notice && (
              <p className="ld-notice" role="status">
                {notice}
              </p>
            )}
          </section>
        </section>
        <section className="ld-directory" ref={directory} aria-labelledby="ld-directory-title">
          <div className="ld-directory-heading">
            <h2 id="ld-directory-title">
              <Globe2 size={19} /> 电台目录
            </h2>
            <span>
              {visible.length.toLocaleString('zh-CN')} /{' '}
              {data.info.stationCount.toLocaleString('zh-CN')}
            </span>
          </div>
          <label className="ld-search">
            <Search size={17} aria-hidden="true" />
            <input
              ref={search}
              type="search"
              aria-label="搜索电台、城市或地区"
              placeholder="搜索电台、城市或地区"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setLimit(pageSize);
              }}
            />
          </label>
          <div className="ld-filters" role="group" aria-label="筛选电台">
            <select
              aria-label="分类"
              value={genre}
              onChange={(event) => {
                setGenre(event.target.value);
                setLimit(pageSize);
              }}
            >
              <option value="">全部分类</option>
              {Object.entries(genres).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
            <select
              aria-label="语言"
              value={language}
              onChange={(event) => {
                setLanguage(event.target.value);
                setLimit(pageSize);
              }}
            >
              <option value="">全部语言</option>
              {data.languages.map(({ code, label }) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-pressed={onlySaved}
              onClick={() => {
                setOnlySaved(!onlySaved);
                setLimit(pageSize);
              }}
            >
              <Star size={13} /> 收藏
            </button>
            <button
              type="button"
              aria-pressed={onlyPlayable}
              onClick={() => {
                setOnlyPlayable(!onlyPlayable);
                setLimit(pageSize);
              }}
            >
              只看可播
            </button>
            {city && (
              <button
                type="button"
                aria-pressed="true"
                onClick={() => {
                  setCity(undefined);
                  setLimit(pageSize);
                }}
              >
                {city.name} ×
              </button>
            )}
          </div>
          {visible.length ? (
            <div className="ld-results">
              <ul className="ld-stations" aria-label="电台列表">
                {visible.slice(0, limit).map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-current={item.id === station.id}
                      onClick={() => {
                        select(item.id);
                        if (matchMedia('(max-width: 700px)').matches)
                          selection.current?.scrollIntoView({ block: 'center' });
                      }}
                    >
                      <span className="ld-row-dot" aria-hidden="true" />
                      <span className="ld-row-text">
                        <strong>{item.name}</strong>
                        <small>{item.location}</small>
                      </span>
                      <span className="ld-row-category">
                        {data.streams.has(item.id) ? '可收听' : genres[item.genre]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {limit < visible.length && (
                <button
                  type="button"
                  className="ld-more"
                  onClick={() => setLimit(limit + pageSize)}
                >
                  加载更多 <ArrowDown size={14} />
                </button>
              )}
            </div>
          ) : (
            <div className="ld-empty">
              <p>
                {onlyPlayable && !data.streams.size
                  ? '暂无开放站内播放的电台'
                  : onlySaved && !favorites.length
                    ? '收藏夹还是空的'
                    : '没有匹配的电台'}
              </p>
              <button
                type="button"
                onClick={() => {
                  reset();
                  search.current?.focus();
                }}
              >
                浏览全部电台
              </button>
            </div>
          )}
          <p className="ld-directory-note">
            目录快照 {data.info.exportedAt.slice(0, 10)} · 收藏保存在当前浏览器
          </p>
        </section>
      </div>
      <footer className="ld-footer">地图数据来自 Natural Earth</footer>
    </main>
  );
}

const container = document.getElementById('haen-ld-root');
if (container) {
  const root = createRoot(container);
  async function start() {
    let sdk: MiniAppSDK | null = null;
    let ready = false;
    try {
      if (!import.meta.env.DEV || Reflect.has(globalThis, 'miniApp')) {
        sdk = getSDK();
        await sdk.ready;
        await sdk.lifecycle.ready();
        ready = true;
      }
      const data = await load(sdk);
      root.render(<App sdk={sdk} data={data} />);
    } catch {
      flushSync(() =>
        root.render(
          <p className="ld-boot" role="alert">
            电台目录未能载入，请重新打开声屿。
          </p>,
        ),
      );
      if (sdk && !ready) await sdk.lifecycle.ready().catch(() => {});
    }
  }
  void start();
}
