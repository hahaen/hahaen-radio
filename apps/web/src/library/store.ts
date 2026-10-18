import { createStore } from 'zustand/vanilla';
import { z } from 'zod';
import {
  FilterSchema,
  AudioOptionsSchema,
  SceneOptionsSchema,
  defaultSceneOptions,
  type SceneOptions,
  defaultAudioOptions,
  type AudioOptions,
  SavedSongSchema,
  SavedStationSchema,
  PreferencesSchema,
  SleepSchema,
  defaultPreferences,
  type Preferences,
  type SleepTimer,
  TransferSchema,
  MAX_LIBRARY_ITEMS,
  LibraryError,
  defaultFilters,
  saveStation,
  songKey,
  type FavoritesTransfer,
  type ListeningFilters,
  type SavedSong,
  type SavedStation,
} from './model';
import type { StationPreview } from '@haen/contracts';

export const LIBRARY_PREFIX = 'haen:personal:v1:';
type StorageLike = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;
type Problem = 'unavailable' | 'corrupt' | null;
type Category =
  | 'favorite'
  | 'song'
  | 'history'
  | 'filters'
  | 'last'
  | 'preferences'
  | 'sleep'
  | 'audio'
  | 'scene';
export interface LibraryState {
  favorites: SavedStation[];
  songs: SavedSong[];
  history: SavedStation[];
  lastStation: SavedStation | null;
  filters: ListeningFilters;
  preferences: Preferences;
  audio: AudioOptions;
  scene: SceneOptions;
  sleep: SleepTimer | null;
  storageProblem: Problem;
}
const stationRecord = z.strictObject({ version: z.literal(1), value: SavedStationSchema });
const songRecord = z.strictObject({ version: z.literal(1), value: SavedSongSchema });
const filterRecord = z.strictObject({ version: z.literal(1), value: FilterSchema });
const preferencesRecord = z.strictObject({ version: z.literal(1), value: PreferencesSchema });
const sceneRecord = z.strictObject({ version: z.literal(1), value: SceneOptionsSchema });
const audioRecord = z.strictObject({ version: z.literal(1), value: AudioOptionsSchema });
const sleepRecord = z.strictObject({ version: z.literal(1), value: SleepSchema });
const newest = <T extends { savedAt: number }>(values: Iterable<T>) =>
  [...values].sort(
    (a, b) => b.savedAt - a.savedAt || JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'),
  );

export function createLibrary(options: { storage?: () => StorageLike; events?: EventTarget } = {}) {
  const favorites = new Map<string, SavedStation>(),
    songs = new Map<string, SavedSong>(),
    history = new Map<string, SavedStation>();
  let filters = defaultFilters(),
    preferences = defaultPreferences(),
    audio = defaultAudioOptions(),
    scene = defaultSceneOptions(),
    sleep: SleepTimer | null = null,
    lastStation: SavedStation | null = null,
    storageProblem: Problem = null,
    storage: StorageLike | undefined,
    writable = true;
  try {
    storage = (options.storage ?? (() => window.localStorage))();
  } catch {
    storageProblem = 'unavailable';
    writable = false;
  }
  const problem = (value: Exclude<Problem, null>) => {
    storageProblem = value;
    writable = false;
  };
  const keyOf = (kind: 'favorite' | 'history' | 'song', id: string) =>
    LIBRARY_PREFIX + kind + ':' + (kind === 'song' ? encodeURIComponent(id) : id);
  function accept(key: string, text: string | null) {
    const suffix = key.slice(LIBRARY_PREFIX.length);
    try {
      if (text !== null && text.length > 32768) throw new Error('INVALID_RECORD_SIZE');
      const input: unknown = text === null ? null : JSON.parse(text);
      if (suffix === 'filters')
        filters = input === null ? defaultFilters() : filterRecord.parse(input).value;
      else if (suffix === 'last')
        lastStation = input === null ? null : stationRecord.parse(input).value;
      else if (suffix === 'preferences')
        preferences = input === null ? defaultPreferences() : preferencesRecord.parse(input).value;
      else if (suffix === 'scene')
        scene = input === null ? defaultSceneOptions() : sceneRecord.parse(input).value;
      else if (suffix === 'audio')
        audio = input === null ? defaultAudioOptions() : audioRecord.parse(input).value;
      else if (suffix === 'sleep') sleep = input === null ? null : sleepRecord.parse(input).value;
      else {
        const separator = suffix.indexOf(':'),
          kind = suffix.slice(0, separator),
          id = suffix.slice(separator + 1);
        if (kind === 'favorite' || kind === 'history') {
          const target = kind === 'favorite' ? favorites : history;
          if (input === null) target.delete(id);
          else {
            const record = stationRecord.parse(input).value;
            if (record.id !== id) throw new Error('INVALID_STATION_KEY');
            target.set(id, record);
          }
        } else if (kind === 'song') {
          const decoded = decodeURIComponent(id);
          if (input === null) songs.delete(decoded);
          else {
            const record = songRecord.parse(input).value;
            if (songKey(record) !== decoded) throw new Error('INVALID_SONG_KEY');
            songs.set(decoded, record);
          }
        }
      }
    } catch {
      problem('corrupt');
    }
  }
  function readAll() {
    if (!storage) return;
    favorites.clear();
    songs.clear();
    history.clear();
    filters = defaultFilters();
    preferences = defaultPreferences();
    audio = defaultAudioOptions();
    scene = defaultSceneOptions();
    sleep = null;
    lastStation = null;
    try {
      if (storage.length > 25000) throw new Error('STORAGE_LIMIT');
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (key?.startsWith(LIBRARY_PREFIX)) accept(key, storage.getItem(key));
      }
    } catch {
      problem('unavailable');
    }
  }
  readAll();
  const snapshot = (): LibraryState => ({
    favorites: newest(favorites.values()),
    songs: newest(songs.values()),
    history: newest(history.values()).slice(0, 100),
    lastStation,
    filters,
    preferences,
    audio,
    scene,
    sleep,
    storageProblem,
  });
  const store = createStore<LibraryState>(() => snapshot());
  function publish(category?: Category) {
    if (!category) store.setState(snapshot());
    else
      store.setState({
        storageProblem,
        ...(category === 'favorite' ? { favorites: newest(favorites.values()) } : {}),
        ...(category === 'song' ? { songs: newest(songs.values()) } : {}),
        ...(category === 'history' ? { history: newest(history.values()).slice(0, 100) } : {}),
        ...(category === 'filters' ? { filters } : {}),
        ...(category === 'last' ? { lastStation } : {}),
        ...(category === 'preferences' ? { preferences } : {}),
        ...(category === 'audio' ? { audio } : {}),
        ...(category === 'scene' ? { scene } : {}),
        ...(category === 'sleep' ? { sleep } : {}),
      });
  }
  function write(key: string, value: unknown | null) {
    const text = value === null ? null : JSON.stringify({ version: 1, value });
    if (storage && writable) {
      try {
        if (text === null) storage.removeItem(key);
        else storage.setItem(key, text);
      } catch {
        problem('unavailable');
      }
    }
    accept(key, text);
  }
  function refresh(key: string) {
    if (!storage || !writable) return;
    try {
      accept(key, storage.getItem(key));
    } catch {
      problem('unavailable');
    }
  }
  function trimHistory() {
    for (const item of newest(history.values()).slice(100)) write(keyOf('history', item.id), null);
  }
  return {
    store,
    attach() {
      const events = options.events ?? window;
      if (writable) readAll();
      const changed = new Set<Category>();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const flush = () => {
        timer = undefined;
        for (const category of changed) publish(category);
        changed.clear();
      };
      const listener = (event: Event) => {
        const change = event as StorageEvent;
        if (change.storageArea && change.storageArea !== storage) return;
        if (change.key === null) {
          if (timer) clearTimeout(timer);
          timer = undefined;
          changed.clear();
          if (writable) readAll();
          publish();
          return;
        }
        if (!change.key.startsWith(LIBRARY_PREFIX)) return;
        refresh(change.key);
        const suffix = change.key.slice(LIBRARY_PREFIX.length).split(':')[0];
        if (suffix === 'history') trimHistory();
        if (
          [
            'favorite',
            'song',
            'history',
            'filters',
            'last',
            'preferences',
            'sleep',
            'audio',
            'scene',
          ].includes(suffix!)
        ) {
          changed.add(suffix as Category);
          timer ??= setTimeout(flush, 16);
        }
      };
      trimHistory();
      publish();
      events.addEventListener('storage', listener);
      return () => {
        events.removeEventListener('storage', listener);
        if (timer) clearTimeout(timer);
        changed.clear();
      };
    },
    setFilters(value: ListeningFilters) {
      const next = FilterSchema.parse(value);
      write(LIBRARY_PREFIX + 'filters', next);
      publish('filters');
    },
    setAudioOptions(patch: Partial<AudioOptions>) {
      refresh(LIBRARY_PREFIX + 'audio');
      write(LIBRARY_PREFIX + 'audio', AudioOptionsSchema.parse({ ...audio, ...patch }));
      publish('audio');
    },
    setSceneOptions(patch: Partial<SceneOptions>) {
      refresh(LIBRARY_PREFIX + 'scene');
      write(LIBRARY_PREFIX + 'scene', SceneOptionsSchema.parse({ ...scene, ...patch }));
      publish('scene');
    },
    setPreferences(patch: Partial<Preferences>) {
      refresh(LIBRARY_PREFIX + 'preferences');
      const next = PreferencesSchema.parse({ ...preferences, ...patch });
      write(LIBRARY_PREFIX + 'preferences', next);
      publish('preferences');
    },
    setSleep(minutes: 0 | 15 | 30 | 60, now = Date.now()) {
      const value =
        minutes === 0
          ? null
          : SleepSchema.parse({
              id: crypto.randomUUID(),
              minutes,
              deadline: now + minutes * 60000,
              expired: false,
            });
      write(LIBRARY_PREFIX + 'sleep', value);
      publish('sleep');
    },
    expireSleep(id: string, now = Date.now()) {
      refresh(LIBRARY_PREFIX + 'sleep');
      if (sleep?.id === id && !sleep.expired && sleep.deadline <= now)
        write(LIBRARY_PREFIX + 'sleep', { ...sleep, expired: true });
      publish('sleep');
    },
    toggleFavorite(station: Pick<StationPreview, 'id' | 'name' | 'countryCode'>) {
      const key = keyOf('favorite', station.id.toLowerCase());
      refresh(key);
      if (favorites.has(station.id.toLowerCase())) write(key, null);
      else {
        if (favorites.size >= MAX_LIBRARY_ITEMS) throw new LibraryError('capacity');
        write(key, saveStation(station));
      }
      publish('favorite');
    },
    removeFavorites(ids: readonly string[]) {
      for (const id of ids) write(keyOf('favorite', id.toLowerCase()), null);
      publish('favorite');
    },
    recordPlayed(station: StationPreview, now = Date.now()) {
      const saved = saveStation(station, now);
      write(keyOf('history', saved.id), saved);
      trimHistory();
      write(LIBRARY_PREFIX + 'last', saved);
      publish('history');
      publish('last');
    },
    clearHistory() {
      if (writable) readAll();
      for (const id of history.keys()) write(keyOf('history', id), null);
      write(LIBRARY_PREFIX + 'last', null);
      publish();
    },
    toggleSong(song: { artist: string; title: string }, now = Date.now()) {
      const value = SavedSongSchema.parse({ ...song, savedAt: now });
      const id = songKey(value),
        key = keyOf('song', id);
      refresh(key);
      if (songs.has(id)) write(key, null);
      else {
        if (songs.size >= MAX_LIBRARY_ITEMS) throw new LibraryError('capacity');
        write(key, value);
      }
      publish('song');
    },
    removeSong(song: { artist: string; title: string }) {
      write(keyOf('song', songKey(song)), null);
      publish('song');
    },
    importFavorites(transfer: FavoritesTransfer) {
      // Validate the whole transfer before any mutation, including non-file callers.
      const items = TransferSchema.parse(transfer);
      if (writable) {
        readAll();
        publish();
      }
      const nextStations = new Map(favorites),
        nextSongs = new Map(songs);
      for (const item of items.stations)
        if (!nextStations.has(item.id)) nextStations.set(item.id, item);
      for (const item of items.songs)
        if (!nextSongs.has(songKey(item))) nextSongs.set(songKey(item), item);
      if (
        (nextStations.size > MAX_LIBRARY_ITEMS && nextStations.size > favorites.size) ||
        (nextSongs.size > MAX_LIBRARY_ITEMS && nextSongs.size > songs.size)
      )
        throw new LibraryError('capacity');
      let added = 0;
      for (const item of nextStations.values())
        if (!favorites.has(item.id)) {
          write(keyOf('favorite', item.id), item);
          added++;
        }
      for (const item of nextSongs.values())
        if (!songs.has(songKey(item))) {
          write(keyOf('song', songKey(item)), item);
          added++;
        }
      publish('favorite');
      publish('song');
      return { added, skipped: items.stations.length + items.songs.length - added };
    },
  };
}
export type Library = ReturnType<typeof createLibrary>;
