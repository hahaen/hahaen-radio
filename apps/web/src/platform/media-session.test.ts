import { expect, it, vi } from 'vitest';
import { createPlayerController } from '../audio/controller';
import { testStation } from '../testing/stations';
import { connectMediaSession } from './media-session';
it('publishes real station metadata and state, handles supported actions and cleans up', () => {
  const player = createPlayerController(),
    handlers = new Map<string, MediaSessionActionHandler | null>();
  const session = {
    metadata: null,
    playbackState: 'none',
    setActionHandler: vi.fn(
      (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
        if (action === 'stop') throw new Error('unsupported');
        handlers.set(action, handler);
      },
    ),
  } as unknown as MediaSession;
  const Metadata = class {
    constructor(init: MediaMetadataInit) {
      Object.assign(this, init);
    }
  } as unknown as typeof MediaMetadata;
  const pause = vi.spyOn(player, 'pause').mockImplementation(() => {}),
    next = vi.spyOn(player, 'next').mockResolvedValue(undefined);
  const off = connectMediaSession(
    player,
    { brand: 'HAEN', genre: () => 'Jazz' },
    { session, metadata: Metadata },
  );
  player.store.setState({
    station: testStation(1),
    intent: true,
    playback: {
      ...player.store.getState().playback,
      status: 'playing',
      stationId: testStation(1).id,
    },
  });
  expect(session.metadata?.title).toBe(testStation(1).name);
  expect(session.playbackState).toBe('playing');
  handlers.get('pause')?.({ action: 'pause' });
  handlers.get('nexttrack')?.({ action: 'nexttrack' });
  expect(pause).toHaveBeenCalledOnce();
  expect(next).toHaveBeenCalledOnce();
  player.store.setState({ station: { ...testStation(1), name: 'Updated station name' } });
  expect(session.metadata?.title).toBe('Updated station name');
  off();
  expect(session.metadata).toBeNull();
  expect(session.playbackState).toBe('none');
  expect(handlers.get('pause')).toBeNull();
});
it('keeps basic playback independent when the optional system surface is absent', () => {
  const player = createPlayerController();
  expect(() =>
    connectMediaSession(
      player,
      { brand: 'HAEN', genre: () => '' },
      { session: {} as MediaSession },
    )(),
  ).not.toThrow();
});
it('uses only metadata belonging to the actual station and stream and drops it during a pending switch', () => {
  const player = createPlayerController(),
    station = testStation(1);
  player.store.setState({
    station,
    intent: true,
    playback: {
      ...player.store.getState().playback,
      stationId: station.id,
      streamId: 'a'.repeat(24),
      status: 'playing',
    },
  });
  const session = {
    metadata: null,
    playbackState: 'none',
    setActionHandler: () => {},
  } as unknown as MediaSession;
  const Metadata = class {
    constructor(value: MediaMetadataInit) {
      Object.assign(this, value);
    }
  } as unknown as typeof MediaMetadata;
  const off = connectMediaSession(
    player,
    {
      brand: 'HAEN',
      genre: () => 'Jazz',
      track: {
        stationId: station.id,
        streamId: 'a'.repeat(24),
        source: 'station-icy',
        observedAt: new Date().toISOString(),
        status: 'available',
        rawTitle: 'Artist - Song',
        song: { artist: 'Artist', title: 'Song' },
        timing: 'unknown',
        retryAfter: 15,
      },
    },
    { session, metadata: Metadata },
  );
  expect(session.metadata?.title).toBe('Song');
  player.store.setState({ station: testStation(2), resolving: true });
  expect(session.metadata?.title).toBe(testStation(2).name);
  off();
});
