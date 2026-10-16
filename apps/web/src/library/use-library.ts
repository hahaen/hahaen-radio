import { useEffect, useState } from 'react';
import type { PlayerController } from '../audio/controller';
import { createLibrary } from './store';

export function useListeningLibrary(player: PlayerController) {
  const [library] = useState(() => createLibrary());
  useEffect(() => library.attach(), [library]);
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
