import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlayerState } from '../audio/controller';
import { getNowPlaying } from '../services/tracks';
export function useNowPlaying(state: PlayerState) {
  const stationId = state.station?.id,
    streamId = state.playback.streamId;
  const active =
    !!stationId &&
    !!streamId &&
    !state.resolving &&
    state.playback.stationId === stationId &&
    state.playback.status === 'playing';
  const query = useQuery({
    queryKey: ['now-playing', stationId, streamId],
    queryFn: ({ signal }) => getNowPlaying(stationId!, streamId!, signal),
    enabled: active,
    retry: 0,
    staleTime: 10000,
    gcTime: 60000,
    refetchInterval: (current) => (active ? (current.state.data?.retryAfter ?? 30) * 1000 : false),
    refetchIntervalInBackground: true,
  });
  const client = useQueryClient();
  useEffect(() => {
    if (!active)
      void client.cancelQueries({ queryKey: ['now-playing', stationId, streamId], exact: true });
  }, [active, client, stationId, streamId]);
  return { ...query, active };
}
