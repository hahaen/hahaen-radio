import { z } from 'zod';
import {
  GenreSchema,
  CollectionStationSchema,
  CollectionSongSchema,
  type StationPreview,
} from '@haen/contracts';
import { normalizeGenreSelection } from '../catalog/genres';

export const MAX_LIBRARY_ITEMS = 5000;
export const MAX_TRANSFER_BYTES = 2 * 1024 * 1024;
const timestamp = z.number().int().nonnegative().max(8640000000000000);
export const SavedStationSchema = CollectionStationSchema;
export type SavedStation = z.infer<typeof SavedStationSchema>;
export const SavedSongSchema = CollectionSongSchema;
export type SavedSong = z.infer<typeof SavedSongSchema>;
export const FilterSchema = z.strictObject({
  q: z.string().max(200),
  genres: z.array(GenreSchema).max(11).nullable().transform(normalizeGenreSelection),
  languages: z.array(z.string().min(1).max(64)).max(32).nullable(),
  minBitrate: z.union([z.literal(0), z.literal(128), z.literal(192), z.literal(320)]),
  favoritesOnly: z.boolean(),
});
export type ListeningFilters = z.infer<typeof FilterSchema>;
export const defaultFilters = (): ListeningFilters => ({
  q: '',
  genres: null,
  languages: null,
  minBitrate: 0,
  favoritesOnly: false,
});
export const PreferencesSchema = z.strictObject({
  volume: z.number().min(0).max(1),
  muted: z.boolean(),
  showHints: z.boolean(),
  view: z.enum(['globe', 'genres']).transform(() => 'globe' as const),
  idleImmersive: z.boolean(),
});
export type Preferences = z.infer<typeof PreferencesSchema>;
export const defaultPreferences = (): Preferences => ({
  volume: 0.7,
  muted: false,
  showHints: true,
  view: 'globe',
  idleImmersive: false,
});
export const SleepSchema = z.strictObject({
  id: z.uuid(),
  deadline: timestamp,
  minutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
  expired: z.boolean(),
});
export type SleepTimer = z.infer<typeof SleepSchema>;
export const songKey = (song: Pick<SavedSong, 'artist' | 'title'>) =>
  JSON.stringify(
    [song.artist, song.title].map((value) =>
      value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase(),
    ),
  );
export const saveStation = (
  station: Pick<StationPreview, 'id' | 'name' | 'countryCode'>,
  now = Date.now(),
): SavedStation =>
  SavedStationSchema.parse({
    id: station.id,
    name: station.name,
    countryCode: station.countryCode,
    savedAt: now,
  });

export const TransferSchema = z.strictObject({
  format: z.literal('haen-favorites'),
  version: z.literal(1),
  exportedAt: z.iso.datetime(),
  stations: z.array(SavedStationSchema).max(MAX_LIBRARY_ITEMS),
  songs: z.array(SavedSongSchema).max(MAX_LIBRARY_ITEMS),
});
export type FavoritesTransfer = z.infer<typeof TransferSchema>;
export class LibraryError extends Error {
  constructor(readonly code: 'size' | 'format' | 'capacity') {
    super(code);
  }
}
export function parseTransfer(text: string): FavoritesTransfer {
  if (new TextEncoder().encode(text).byteLength > MAX_TRANSFER_BYTES)
    throw new LibraryError('size');
  try {
    return TransferSchema.parse(JSON.parse(text));
  } catch {
    throw new LibraryError('format');
  }
}
export async function readTransfer(file: File) {
  if (file.size > MAX_TRANSFER_BYTES) throw new LibraryError('size');
  return parseTransfer(await file.text());
}
export function exportFavorites(stations: SavedStation[], songs: SavedSong[], now = new Date()) {
  const base = {
    format: 'haen-favorites' as const,
    version: 1 as const,
    exportedAt: now.toISOString(),
  };
  const parts: string[] = [];
  let current = { ...base, stations: [] as SavedStation[], songs: [] as SavedSong[] };
  let size = new TextEncoder().encode(JSON.stringify(current)).byteLength;
  const append = (kind: 'stations' | 'songs', item: SavedStation | SavedSong) => {
    const bytes = new TextEncoder().encode(JSON.stringify(item)).byteLength + 1;
    if (size + bytes > MAX_TRANSFER_BYTES || current[kind].length >= MAX_LIBRARY_ITEMS) {
      parts.push(JSON.stringify(current));
      current = { ...base, stations: [], songs: [] };
      size = new TextEncoder().encode(JSON.stringify(current)).byteLength;
    }
    if (kind === 'stations') current.stations.push(SavedStationSchema.parse(item));
    else current.songs.push(SavedSongSchema.parse(item));
    size += bytes;
  };
  for (const station of stations) append('stations', station);
  for (const song of songs) append('songs', song);
  parts.push(JSON.stringify(current));
  return parts;
}

export const AudioOptionsSchema = z.strictObject({ normalize: z.boolean(), tuning: z.boolean() });
export type AudioOptions = z.infer<typeof AudioOptionsSchema>;
export const defaultAudioOptions = (): AudioOptions => ({ normalize: false, tuning: false });

export const IMMERSION_EFFECTS = ['aurora', 'ocean', 'dunes'] as const;
export type ImmersionEffect = (typeof IMMERSION_EFFECTS)[number];
export const SceneOptionsSchema = z.strictObject({
  powerSave: z.boolean(),
  immersion: z
    .enum(['auto', ...IMMERSION_EFFECTS, 'record', 'orb', 'landscape'])
    .transform((value) =>
      value === 'record'
        ? 'aurora'
        : value === 'orb'
          ? 'ocean'
          : value === 'landscape'
            ? 'dunes'
            : value,
    ),
});
export type SceneOptions = z.infer<typeof SceneOptionsSchema>;
export const defaultSceneOptions = (): SceneOptions => ({ powerSave: false, immersion: 'ocean' });
