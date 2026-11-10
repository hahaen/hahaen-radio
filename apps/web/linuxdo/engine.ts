import type { MiniAppSDK } from '@discourse-mini-app/sdk';
import type { PlaybackSnapshot } from '../src/audio/engine';
import { createPlayer } from './player';

export function createEngine(sdk: MiniAppSDK, endpoint: (id: string) => string | undefined) {
  let snapshot: PlaybackSnapshot = {
    stationId: null,
    status: 'idle',
    failure: null,
    attempt: 0,
    streamId: null,
    volume: 0.7,
    muted: false,
    volumeControllable: true,
  };
  const listeners = new Set<() => void>();
  const update = (patch: Partial<PlaybackSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };
  const player = createPlayer(sdk, (state) => {
    if (state === 'idle') return;
    if (state === 'error' || state === 'unsupported') {
      update({ status: 'failed', failure: state === 'unsupported' ? 'unsupported' : 'network' });
    } else {
      update({ status: state, failure: null });
    }
  });
  const pause = () => {
    player.stop();
    update({ status: snapshot.stationId ? 'paused' : 'idle', failure: null });
  };
  window.addEventListener('pagehide', pause);
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    select(stationId: string) {
      player.stop();
      update({ stationId, status: 'paused', failure: null });
    },
    play() {
      const name = snapshot.stationId && endpoint(snapshot.stationId);
      if (name) player.play(name);
    },
    pause,
    activateAudio() {},
    setAudioOptions() {},
    setOnline() {},
    setVolume(volume: number) {
      update({ volume });
      player.setVolume(snapshot.muted ? 0 : volume);
    },
    setMuted(muted: boolean) {
      update({ muted });
      player.setVolume(muted ? 0 : snapshot.volume);
    },
    destroy() {
      window.removeEventListener('pagehide', pause);
      listeners.clear();
      player.stop();
    },
  };
}
