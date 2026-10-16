import { z } from 'zod';
import { GenreSchema, StationIdSchema, type StationPreview } from '@haen/contracts';

export const MAX_LIBRARY_ITEMS = 5000;
export const MAX_TRANSFER_BYTES = 2 * 1024 * 1024;
const timestamp = z.number().int().nonnegative().max(8640000000000000);
export const SavedStationSchema = z.strictObject({
  id: StationIdSchema.transform((id) => id.toLowerCase()),
  name: z.string().trim().min(1).max(512),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable(),
  savedAt: timestamp,
});
export type SavedStation = z.infer<typeof SavedStationSchema>;
export const SavedSongSchema = z.strictObject({
  artist: z.string().trim().min(1).max(512),
  title: z.string().trim().min(1).max(512),
  savedAt: timestamp,
});
export type SavedSong = z.infer<typeof SavedSongSchema>;
export const FilterSchema = z.strictObject({
  q: z.string().max(200),
  genres: z.array(GenreSchema).max(11).nullable(),
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
