import type { LyricsResult, SongIdentity } from '@haen/contracts';
import { canonicalSongText, LyricsRateLimited, searchLyrics } from '../../integrations/lrclib.js';
import { boundedCache } from './cache.js';
export function createLyricsService(
  options: { search?: typeof searchLyrics; now?: () => number } = {},
) {
  const now = options.now ?? Date.now,
    search = options.search ?? searchLyrics;
  const cache = boundedCache<LyricsResult>(128),
    pending = new Map<string, Promise<LyricsResult>>();
  const abort = new AbortController();
  let nextRequest = 0,
    cooldown = 0,
    closed = false;
  const temporary = (status: LyricsResult['status'], seconds: number): LyricsResult => ({
    source: 'lrclib',
    status,
    items: [],
    retryAfter: Math.min(86400, Math.max(1, Math.ceil(seconds))),
  });
  return {
    async find(song: SongIdentity): Promise<LyricsResult> {
      const key = JSON.stringify([song.artist, song.title].map(canonicalSongText));
      const cached = cache.get(key, now());
      if (cached) return cached;
      const task = pending.get(key);
      if (task) return task;
      if (cooldown > now()) return temporary('rate-limited', (cooldown - now()) / 1000);
      if (closed || pending.size || nextRequest > now())
        return temporary('busy', (nextRequest - now()) / 1000);
      const loading = (async (): Promise<LyricsResult> => {
        try {
          const items = await search(song, abort.signal);
          const result: LyricsResult = {
            source: 'lrclib',
            status: items.length ? 'found' : 'not-found',
            items,
            retryAfter: null,
          };
          if (!closed) cache.set(key, result, now() + (items.length ? 86400000 : 600000));
          return result;
        } catch (error) {
          if (error instanceof LyricsRateLimited) {
            cooldown = Math.max(cooldown, error.until);
            return temporary('rate-limited', (cooldown - now()) / 1000);
          }
          const result = temporary('unavailable', 30);
          if (!closed) cache.set(key, result, now() + 30000);
          return result;
        }
      })().finally(() => {
        pending.delete(key);
        nextRequest = now() + 500;
      });
      pending.set(key, loading);
      return loading;
    },
    close() {
      closed = true;
      abort.abort();
      cache.clear();
    },
  };
}
export type LyricsService = ReturnType<typeof createLyricsService>;
