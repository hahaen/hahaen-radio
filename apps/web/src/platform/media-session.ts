import type { NowPlaying } from '@haen/contracts';
import type { PlayerController } from '../audio/controller';

export function connectMediaSession(
  player: PlayerController,
  labels: { brand: string; genre(id: string): string; track?: NowPlaying },
  platform: {
    session?: MediaSession;
    metadata?: typeof MediaMetadata;
  } = {},
) {
  let session: MediaSession | undefined;
  try {
    session = platform.session ?? navigator.mediaSession;
  } catch {
    return () => {};
  }
  if (!session || typeof session.setActionHandler !== 'function') return () => {};
  const installed: MediaSessionAction[] = [];
  const actions: Partial<Record<MediaSessionAction, () => void>> = {
    play: () => {
      const state = player.store.getState();
      if (state.station || state.resolving) player.play();
      else void player.start();
    },
    pause: () => player.pause(),
    stop: () => player.pause(),
    previoustrack: () => player.previous(),
    nexttrack: () => {
      void player.next();
    },
  };
  for (const [action, callback] of Object.entries(actions)) {
    try {
      session.setActionHandler(action as MediaSessionAction, callback);
      installed.push(action as MediaSessionAction);
    } catch {
      /* Actions differ by browser. */
    }
  }
  const activeSession = session;
  let signature: string | null = null;
  const update = () => {
    const state = player.store.getState();
    const song =
      labels.track?.stationId === state.station?.id &&
      labels.track?.streamId === state.playback.streamId &&
      !state.resolving &&
      state.intent
        ? labels.track?.song
        : undefined;
    try {
      const next = state.station
        ? JSON.stringify([state.station.id, state.station.name, state.station.genre, song])
        : '';
      if (signature !== next) {
        signature = next;
        const Metadata =
          platform.metadata ?? (typeof MediaMetadata === 'function' ? MediaMetadata : undefined);
        activeSession.metadata =
          state.station && Metadata
            ? new Metadata({
                title: song?.title ?? state.station.name,
                artist: song?.artist ?? labels.genre(state.station.genre),
                album: song ? state.station.name + ' · ' + labels.brand : labels.brand,
              })
            : null;
      }
      activeSession.playbackState = !state.station
        ? 'none'
        : ['playing', 'buffering'].includes(state.playback.status) &&
            state.intent &&
            !state.resolving
          ? 'playing'
          : 'paused';
    } catch {
      /* Basic playback remains independent. */
    }
  };
  const off = player.store.subscribe(update);
  update();
  return () => {
    off();
    for (const action of installed) {
      try {
        activeSession.setActionHandler(action, null);
      } catch {
        /* Optional action. */
      }
    }
    try {
      activeSession.metadata = null;
      activeSession.playbackState = 'none';
    } catch {
      /* Optional surface. */
    }
  };
}
