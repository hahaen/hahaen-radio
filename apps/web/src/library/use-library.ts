import { useEffect, useState } from 'react';
import type { PlayerController } from '../audio/controller';
import { createLibrary } from './store';

export function useListeningLibrary(player: PlayerController) {
  const [library] = useState(() => createLibrary());
  useEffect(() => {
    const detach = library.attach();
    player.seedHistory(library.store.getState().history.map((item) => item.id));
    let applying = false;
    const apply = () => {
      applying = true;
      const preferences = library.store.getState().preferences,
        playback = player.store.getState().playback;
      if (playback.volume !== preferences.volume) player.setVolume(preferences.volume);
      if (playback.muted !== preferences.muted) player.setMuted(preferences.muted);
      applying = false;
    };
    apply();
    const offLibrary = library.store.subscribe((state, previous) => {
      if (state.preferences !== previous.preferences) apply();
      if (state.history.length === 0 && previous.history.length > 0) player.clearVisits();
    });
    const offVolume = player.store.subscribe((state, previous) => {
      if (
        !applying &&
        (state.playback.volume !== previous.playback.volume ||
          state.playback.muted !== previous.playback.muted)
      )
        library.setPreferences({
          ...(state.playback.volume !== previous.playback.volume
            ? { volume: state.playback.volume }
            : {}),
          ...(state.playback.muted !== previous.playback.muted
            ? { muted: state.playback.muted }
            : {}),
        });
    });
    return () => {
      offVolume();
      offLibrary();
      detach();
    };
  }, [library, player]);
  useEffect(
    () =>
      player.store.subscribe((state, previous) => {
        if (
          state.station &&
          !state.resolving &&
          !state.requestFailure &&
          state.playback.status === 'playing' &&
          state.playback.stationId === state.station.id &&
          (previous.playback.status !== 'playing' ||
            previous.playback.stationId !== state.playback.stationId)
        )
          library.recordPlayed(state.station);
      }),
    [library, player],
  );
  return library;
}
