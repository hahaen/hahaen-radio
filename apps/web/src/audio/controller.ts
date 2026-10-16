import { createStore } from 'zustand/vanilla';
import type { StationDetail, StationPreview } from '@haen/contracts';
import { AudioEngine, type PlaybackSnapshot } from './engine';
import { getStation } from '../services/catalog';
import { HttpError } from '../services/http';

export interface PlayerState {
  selectionVersion: number;
  station: StationPreview | null;
  detail: StationDetail | null;
  playback: PlaybackSnapshot;
  resolving: boolean;
  intent: boolean;
  requestFailure: 'network' | 'not-found' | 'unavailable' | 'empty' | 'offline' | null;
  pinned: boolean;
  autoSkips: number;
  canGoBack: boolean;
}
type Explorer = (
  signal: AbortSignal,
  excludeIds: readonly string[],
) => Promise<StationPreview | null>;
export function createPlayerController(
  options: {
    createEngine?: () => AudioEngine;
    station?: (id: string, signal: AbortSignal) => Promise<StationDetail>;
  } = {},
) {
  const emptyPlayback: PlaybackSnapshot = {
    stationId: null,
    status: 'idle',
    failure: null,
    attempt: 0,
    streamId: null,
    volume: 0.7,
    muted: false,
    volumeControllable: true,
  };
  const store = createStore<PlayerState>(() => ({
    selectionVersion: 0,
    station: null,
    detail: null,
    playback: emptyPlayback,
    resolving: false,
    intent: false,
    requestFailure: null,
    pinned: false,
    autoSkips: 0,
    canGoBack: false,
  }));
  let engine: AudioEngine | undefined;
  let unsubscribe: (() => void) | undefined;
  let request: AbortController | undefined;
  let token = 0;
  let wantsPlayback = false;
  let networkOnline = true;
  let explorer: Explorer | undefined;
  let exploring = false;
  let automaticExploration = false;
  const failedStations = new Set<string>();
  const visits: StationPreview[] = [];
  let cursor = -1;
  const canGoBack = (id = store.getState().station?.id) =>
    cursor >= 0 && (visits[cursor]?.id !== id || cursor > 0);
  const invalidateSelection = () =>
    store.setState((state) => ({ selectionVersion: state.selectionVersion + 1 }));
  const cancel = () => {
    invalidateSelection();
    token++;
    request?.abort();
    request = undefined;
    exploring = false;
    automaticExploration = false;
  };
  const onPlayback = () => {
    if (!engine) return;
    const playback = engine.getSnapshot();
    const state = store.getState();
    if (
      playback.status === 'playing' &&
      state.station?.id === playback.stationId &&
      visits[cursor]?.id !== state.station.id
    ) {
      visits.splice(cursor + 1);
      visits.push(state.station);
      if (visits.length > 100) visits.shift();
      cursor = visits.length - 1;
    }
    if (playback.status === 'paused') wantsPlayback = false;
    store.setState({ playback, canGoBack: canGoBack(), intent: wantsPlayback });
    if (playback.status === 'failed' && playback.stationId) failedStations.add(playback.stationId);
    if (
      playback.status === 'failed' &&
      state.playback.status !== 'failed' &&
      ['network', 'timeout', 'unsupported'].includes(playback.failure ?? '') &&
      wantsPlayback &&
      !state.resolving &&
      !state.pinned &&
      state.autoSkips < 2 &&
      explorer
    ) {
      const expected = token;
      queueMicrotask(() => {
        if (
          expected !== token ||
          !engine ||
          !wantsPlayback ||
          store.getState().pinned ||
          engine.getSnapshot().status !== 'failed'
        )
          return;
        void explore(true, true);
      });
    }
  };
  async function select(station: StationPreview, autoplay = true, automatic = false) {
    if (!engine) return;
    cancel();
    if (!automatic) failedStations.clear();
    const selectedToken = token;
    request = new AbortController();
    const signal = request.signal;
    engine.pause();
    wantsPlayback = autoplay;
    store.setState({
      station,
      detail: null,
      resolving: true,
      intent: autoplay,
      requestFailure: null,
      autoSkips: automatic ? store.getState().autoSkips : 0,
      canGoBack: canGoBack(station.id),
    });
    if (!networkOnline) {
      store.setState({ resolving: false, requestFailure: 'offline' });
      return;
    }
    try {
      const detail = await (options.station ?? getStation)(station.id, signal);
      if (signal.aborted || selectedToken !== token || !engine) return;
      store.setState({
        station: detail,
        detail,
        resolving: false,
        requestFailure:
          detail.availability === 'available' && detail.streams.length ? null : 'unavailable',
      });
      engine.select(
        detail.id,
        detail.availability === 'available' ? detail.streams : [],
        wantsPlayback,
      );
    } catch (error) {
      if (signal.aborted || selectedToken !== token) return;
      store.setState({
        resolving: false,
        requestFailure:
          error instanceof HttpError && error.status === 404 ? 'not-found' : 'network',
      });
    }
  }
  async function explore(autoplay: boolean, automatic = false) {
    if (!engine || !explorer) return;
    cancel();
    if (!networkOnline) {
      store.setState({ resolving: false, requestFailure: 'offline' });
      return;
    }
    const selectedToken = token;
    request = new AbortController();
    const signal = request.signal;
    exploring = true;
    automaticExploration = automatic;
    if (!automatic) {
      failedStations.clear();
      store.setState({ autoSkips: 0 });
    } else store.setState({ autoSkips: store.getState().autoSkips + 1 });
    store.setState({ resolving: true, requestFailure: null, intent: autoplay });
    wantsPlayback = autoplay;
    try {
      const excluded = new Set(failedStations);
      const currentId = store.getState().station?.id;
      if (currentId) excluded.add(currentId);
      const station = await explorer(signal, [...excluded]);
      if (selectedToken !== token || signal.aborted) return;
      exploring = false;
      if (!station) {
        store.setState({ resolving: false, requestFailure: 'empty' });
        return;
      }
      await select(station, wantsPlayback, automatic);
    } catch {
      if (selectedToken === token && !signal.aborted)
        store.setState({ resolving: false, requestFailure: 'network' });
    }
  }
  return {
    store,
    attach() {
      if (engine) return;
      engine = (options.createEngine ?? (() => new AudioEngine()))();
      engine.setVolume(store.getState().playback.volume);
      engine.setMuted(store.getState().playback.muted);
      const detail = store.getState().detail;
      if (detail)
        engine.select(detail.id, detail.availability === 'available' ? detail.streams : [], false);
      unsubscribe = engine.subscribe(onPlayback);
      onPlayback();
    },
    detach() {
      cancel();
      unsubscribe?.();
      unsubscribe = undefined;
      engine?.destroy();
      engine = undefined;
      wantsPlayback = false;
      store.setState({
        playback: {
          ...store.getState().playback,
          status: store.getState().station ? 'paused' : 'idle',
        },
        resolving: false,
        intent: false,
      });
    },
    setExplorer(value: Explorer) {
      explorer = value;
      invalidateSelection();
      if (exploring) {
        cancel();
        store.setState({ resolving: false });
      }
    },
    select,
    invalidateSelection,
    next: () => explore(wantsPlayback || !store.getState().station),
    start: () => explore(true),
    previous() {
      const state = store.getState();
      const index = visits[cursor]?.id === state.station?.id ? cursor - 1 : cursor;
      const station = visits[index];
      if (!station) return;
      cursor = index;
      void select(station, wantsPlayback);
    },
    play() {
      invalidateSelection();
      if (!networkOnline) {
        store.setState({ requestFailure: 'offline' });
        return;
      }
      wantsPlayback = true;
      store.setState({ requestFailure: null, autoSkips: 0, intent: true });
      const state = store.getState();
      if (state.resolving) return;
      if (state.station && (state.detail === null || state.detail.availability !== 'available'))
        void select(state.station, true);
      else engine?.play();
    },
    pause() {
      invalidateSelection();
      wantsPlayback = false;
      store.setState({ intent: false });
      engine?.pause();
    },
    retry() {
      const station = store.getState().station;
      if (station) void select(station, true);
      else void explore(true);
    },
    setPinned(pinned: boolean) {
      invalidateSelection();
      store.setState({ pinned });
      if (pinned && automaticExploration) {
        cancel();
        store.setState({ resolving: false });
      }
    },
    setVolume: (volume: number) => engine?.setVolume(volume),
    setMuted: (muted: boolean) => engine?.setMuted(muted),
    setOnline(online: boolean) {
      networkOnline = online;
      if (!online) {
        cancel();
        store.setState({
          resolving: false,
          requestFailure: store.getState().station ? 'offline' : null,
        });
      }
      engine?.setOnline(online);
    },
  };
}
export type PlayerController = ReturnType<typeof createPlayerController>;
