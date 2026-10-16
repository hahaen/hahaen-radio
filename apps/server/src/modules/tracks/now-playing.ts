import type { NowPlaying } from '@haen/contracts';
import { parseBroadcastTitle, readIcyTitle } from '../../integrations/icy.js';
import type { CatalogService } from '../catalog/service.js';
import { CatalogNotFoundError } from '../catalog/service.js';
import { boundedCache } from './cache.js';

export function createNowPlayingService(
  catalog: Pick<CatalogService, 'station'>,
  options: {
    read?: typeof readIcyTitle;
    now?: () => number;
  } = {},
) {
  const now = options.now ?? Date.now,
    read = options.read ?? readIcyTitle;
  const cache = boundedCache<NowPlaying>(256),
    pending = new Map<string, Promise<NowPlaying>>();
  const abort = new AbortController();
  let tokens = 8,
    replenishedAt = now(),
    closed = false;
  return {
    async current(id: string, streamId: string): Promise<NowPlaying> {
      const station = await catalog.station(id);
      const stream = station.streams.find((item) => item.id === streamId);
      if (station.availability !== 'available' || !stream) throw new CatalogNotFoundError();
      const key = station.id + ':' + streamId + ':' + stream.url;
      const cached = cache.get(key, now());
      if (cached) return cached;
      const current = pending.get(key);
      if (current) return current;
      const base = {
        stationId: station.id,
        streamId,
        source: 'station-icy' as const,
        observedAt: new Date(now()).toISOString(),
        rawTitle: null,
        song: null,
        timing: 'unknown' as const,
        retryAfter: 60,
      };
      if (stream.hls) return { ...base, status: 'unavailable' };
      tokens = Math.min(8, tokens + Math.max(0, now() - replenishedAt) / 2000);
      replenishedAt = now();
      if (closed || pending.size >= 4 || tokens < 1)
        return { ...base, status: 'busy', retryAfter: 15 };
      tokens--;
      const task = (async (): Promise<NowPlaying> => {
        let value: NowPlaying;
        try {
          const rawTitle = await read(stream.url, abort.signal);
          value = {
            ...base,
            observedAt: new Date(now()).toISOString(),
            rawTitle,
            song: rawTitle ? parseBroadcastTitle(rawTitle, station.name) : null,
            status: rawTitle ? 'available' : 'unavailable',
            retryAfter: rawTitle ? 15 : 60,
          };
        } catch {
          value = { ...base, status: 'error', retryAfter: 30 };
        }
        if (!closed) cache.set(key, value, now() + value.retryAfter * 1000);
        return value;
      })().finally(() => pending.delete(key));
      pending.set(key, task);
      return task;
    },
    close() {
      closed = true;
      abort.abort();
      cache.clear();
    },
  };
}
export type NowPlayingService = ReturnType<typeof createNowPlayingService>;
