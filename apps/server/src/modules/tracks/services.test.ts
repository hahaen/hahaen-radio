import { expect, it, vi } from 'vitest';
import { normalizeStation } from '../catalog/normalize.js';
import { LyricsRateLimited } from '../../integrations/lrclib.js';
import { createNowPlayingService } from './now-playing.js';
import { createLyricsService } from './lyrics.js';
import { boundedCache } from './cache.js';
const station = normalizeStation({
  stationuuid: '00000000-0000-4000-8000-000000000001',
  name: 'Station',
  url: 'https://radio.example/live',
  lastcheckok: 1,
})!;
it('coalesces station reads, caches briefly, and still rechecks current directory restrictions', async () => {
  let now = 0,
    finish: (value: string | null) => void = () => {};
  const read = vi.fn(
    () =>
      new Promise<string | null>((resolve) => {
        finish = resolve;
      }),
  );
  const catalog = { station: vi.fn(async () => station) },
    service = createNowPlayingService(catalog, { read, now: () => now });
  const stream = station.streams[0]!;
  const first = service.current(station.id, stream.id),
    second = service.current(station.id, stream.id);
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
  finish('Artist - Title');
  expect((await first).song).toEqual({ artist: 'Artist', title: 'Title' });
  expect(await second).toEqual(await first);
  await service.current(station.id, stream.id);
  expect(read).toHaveBeenCalledOnce();
  catalog.station.mockResolvedValue({ ...station, availability: 'blocked', streams: [] });
  await expect(service.current(station.id, stream.id)).rejects.toThrow('CATALOG_NOT_FOUND');
  now += 15001;
  catalog.station.mockResolvedValue(station);
  const third = service.current(station.id, stream.id);
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  finish(null);
  expect((await third).status).toBe('unavailable');
  service.close();
});
it('bounds parallel metadata reads and aborts active short reads when closed', async () => {
  const read = vi.fn(
    (_url: string, signal?: AbortSignal) =>
      new Promise<null>((resolve) => {
        signal?.addEventListener('abort', () => resolve(null), { once: true });
      }),
  );
  const catalog = { station: vi.fn(async (id: string) => ({ ...station, id })) },
    service = createNowPlayingService(catalog, { read });
  const tasks = [1, 2, 3, 4].map((id) => service.current(String(id), station.streams[0]!.id));
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(4));
  expect((await service.current('5', station.streams[0]!.id)).status).toBe('busy');
  service.close();
  await Promise.all(tasks);
});
it('coalesces lyrics, rejects extra concurrent upstream work, caches and honors global cooldowns', async () => {
  let now = 0,
    finish: (value: []) => void = () => {};
  const search = vi.fn(
    () =>
      new Promise<[]>((resolve) => {
        finish = resolve;
      }),
  );
  const service = createLyricsService({ search, now: () => now }),
    song = { artist: 'Artist', title: 'Title' };
  const first = service.find(song),
    duplicate = service.find(song);
  expect(search).toHaveBeenCalledOnce();
  expect((await service.find({ ...song, title: 'Other' })).status).toBe('busy');
  finish([]);
  expect((await first).status).toBe('not-found');
  expect(await duplicate).toEqual(await first);
  expect((await service.find(song)).status).toBe('not-found');
  expect(search).toHaveBeenCalledOnce();
  now = 501;
  search.mockRejectedValueOnce(new LyricsRateLimited(60000));
  expect((await service.find({ ...song, title: 'Other' })).retryAfter).toBe(60);
  expect((await service.find({ ...song, title: 'Third' })).status).toBe('rate-limited');
  expect(search).toHaveBeenCalledTimes(2);
  now = 60501;
  search.mockResolvedValueOnce([]);
  expect((await service.find({ ...song, title: 'Third' })).status).toBe('not-found');
  service.close();
});
it('evicts cache entries by byte budget and expiry', () => {
  const cache = boundedCache<string>(3, 10);
  cache.set('one', '1234', 100);
  cache.set('two', '5678', 100);
  expect(cache.get('one', 1)).toBeUndefined();
  expect(cache.get('two', 1)).toBe('5678');
  expect(cache.get('two', 100)).toBeUndefined();
});
