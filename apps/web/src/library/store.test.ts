import { describe, expect, it, vi } from 'vitest';
import { createLibrary, LIBRARY_PREFIX } from './store';
import {
  defaultFilters,
  exportFavorites,
  parseTransfer,
  MAX_TRANSFER_BYTES,
  songKey,
} from './model';
import { testStation } from '../testing/stations';
function environment() {
  const values = new Map<string, string>();
  const events = new EventTarget();
  const storage = {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const change = (
    key: string | null,
    oldValue: string | null = null,
    newValue: string | null = null,
  ) => {
    const event = new Event('storage');
    Object.assign(event, { key, oldValue, newValue });
    events.dispatchEvent(event);
  };
  return { storage: () => storage, events, values, change };
}
describe('local personal library', () => {
  it('preserves independent concurrent favorites, reads current values for delayed events, and removes across tabs', async () => {
    const env = environment(),
      a = createLibrary(env),
      b = createLibrary(env);
    const stopA = a.attach(),
      stopB = b.attach();
    a.toggleFavorite(testStation(1));
    b.toggleFavorite(testStation(2));
    const first = LIBRARY_PREFIX + 'favorite:' + testStation(1).id,
      second = LIBRARY_PREFIX + 'favorite:' + testStation(2).id;
    env.change(second);
    env.change(first);
    await vi.waitFor(() => expect(a.store.getState().favorites).toHaveLength(2));
    expect(a.store.getState().favorites).toHaveLength(2);
    expect(b.store.getState().favorites).toHaveLength(2);
    const old = env.values.get(first)!;
    a.toggleFavorite(testStation(1));
    env.change(first, null, old);
    await vi.waitFor(() => expect(b.store.getState().favorites).toHaveLength(1));
    expect(b.store.getState().favorites.map((s) => s.id)).toEqual([testStation(2).id]);
    stopA();
    stopB();
  });
  it('coalesces a burst of storage events and cancels pending publication on detach', async () => {
    const env = environment(),
      library = createLibrary(env),
      source = createLibrary(env);
    const stop = library.attach(),
      listener = vi.fn();
    const unsubscribe = library.store.subscribe(listener);
    for (let n = 1; n <= 100; n++) {
      source.toggleFavorite(testStation(n));
      env.change(LIBRARY_PREFIX + 'favorite:' + testStation(n).id);
    }
    expect(listener).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(library.store.getState().favorites).toHaveLength(100));
    expect(listener).toHaveBeenCalledTimes(1);
    source.toggleFavorite(testStation(101));
    env.change(LIBRARY_PREFIX + 'favorite:' + testStation(101).id);
    stop();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
  it('restores filters and successful history, deduplicates and retains exactly 100 recent stations', () => {
    const env = environment(),
      library = createLibrary(env);
    for (let n = 1; n <= 110; n++) library.recordPlayed(testStation(n), n);
    library.recordPlayed(testStation(50), 1000);
    library.setFilters({ ...defaultFilters(), genres: [], favoritesOnly: true });
    const restored = createLibrary(env).store.getState();
    expect(restored.history).toHaveLength(100);
    expect(restored.history[0]?.id).toBe(testStation(50).id);
    expect(restored.lastStation?.id).toBe(testStation(50).id);
    expect(restored.filters.genres).toEqual([]);
    expect([...env.values.keys()].filter((key) => key.includes(':history:'))).toHaveLength(100);
    library.clearHistory();
    expect(createLibrary(env).store.getState().history).toEqual([]);
    expect(createLibrary(env).store.getState().lastStation).toBeNull();
  });
  it('keeps corrupt or unsupported records untouched and offers session storage on denial or quota failure', () => {
    const env = environment(),
      key = LIBRARY_PREFIX + 'favorite:' + testStation(1).id;
    env.values.set(key, '{"version":2}');
    const library = createLibrary(env);
    expect(library.store.getState().storageProblem).toBe('corrupt');
    library.toggleFavorite(testStation(2));
    expect(library.store.getState().favorites).toHaveLength(1);
    expect(env.values.get(key)).toBe('{"version":2}');
    const denied = createLibrary({
      storage: () => {
        throw new Error('denied');
      },
    });
    denied.toggleFavorite(testStation(1));
    expect(denied.store.getState().favorites).toHaveLength(1);
    expect(denied.store.getState().storageProblem).toBe('unavailable');
    const quota = environment();
    const original = quota.storage();
    const limited = createLibrary({
      storage: () => ({
        ...original,
        setItem: () => {
          throw new Error('quota');
        },
      }),
    });
    limited.toggleFavorite(testStation(1));
    expect(limited.store.getState().favorites).toHaveLength(1);
    expect(limited.store.getState().storageProblem).toBe('unavailable');
  });
  it('validates before import, merges without replacing existing favorites, and preserves song favorites', () => {
    const env = environment(),
      library = createLibrary(env);
    library.toggleFavorite(testStation(1));
    const first = library.store.getState().favorites[0]!;
    const song = { artist: 'An Artist', title: 'A Song', savedAt: 1 };
    const transfer = parseTransfer(
      exportFavorites(
        [
          { ...first, name: 'Old name' },
          { ...first, id: testStation(2).id },
        ],
        [song, { ...song, artist: 'AN ARTIST' }],
      )[0]!,
    );
    expect(library.importFavorites(transfer)).toEqual({ added: 2, skipped: 2 });
    expect(library.store.getState().favorites.find((s) => s.id === first.id)?.name).toBe(
      first.name,
    );
    expect(library.store.getState().songs).toHaveLength(1);
    expect(songKey(library.store.getState().songs[0]!)).toBe(songKey(song));
    expect(library.importFavorites(transfer).added).toBe(0);
    expect(() => library.importFavorites({ ...transfer, version: 2 } as never)).toThrow();
    expect(library.store.getState().favorites).toHaveLength(2);
  });
  it('checks UTF-8 bytes before parsing and splits large exports into independently importable parts', () => {
    expect(() => parseTransfer('界'.repeat(MAX_TRANSFER_BYTES / 2))).toThrow('size');
    expect(() => parseTransfer('{broken')).toThrow('format');
    const song = { artist: '艺'.repeat(512), title: '曲'.repeat(512), savedAt: 0 };
    const songs = Array.from({ length: 1500 }, (_, n) => ({
      ...song,
      title: String(n) + song.title.slice(5),
    }));
    const parts = exportFavorites([], songs);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.flatMap((part) => parseTransfer(part).songs)).toHaveLength(songs.length);
    for (const part of parts)
      expect(new TextEncoder().encode(part).byteLength).toBeLessThanOrEqual(MAX_TRANSFER_BYTES);
    const valid = parseTransfer(exportFavorites([], [song])[0]!);
    expect(() => parseTransfer(JSON.stringify({ ...valid, unknown: '<script>' }))).toThrow(
      'format',
    );
    expect(() =>
      parseTransfer(
        JSON.stringify({ ...valid, songs: [{ ...song, savedAt: Number.MAX_SAFE_INTEGER }] }),
      ),
    ).toThrow('format');
  });
});
