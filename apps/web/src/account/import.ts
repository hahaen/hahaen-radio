import { z } from 'zod';
import { collectionSongKey, type AccountCollection } from '@haen/contracts';
const stamps = z.record(z.string(), z.number());
export const GuestImportSchema = z.strictObject({
  favorites: stamps,
  songs: stamps,
  history: stamps,
});
export type GuestImport = z.infer<typeof GuestImportSchema>;
export function guestStamp(value: AccountCollection): GuestImport {
  return {
    favorites: Object.fromEntries(value.favorites.map((item) => [item.id, item.savedAt])),
    songs: Object.fromEntries(value.songs.map((item) => [collectionSongKey(item), item.savedAt])),
    history: Object.fromEntries(value.history.map((item) => [item.id, item.savedAt])),
  };
}
export function newGuestItems(value: AccountCollection, previous: GuestImport): AccountCollection {
  return {
    favorites: value.favorites.filter((item) => (previous.favorites[item.id] ?? -1) < item.savedAt),
    songs: value.songs.filter(
      (item) => (previous.songs[collectionSongKey(item)] ?? -1) < item.savedAt,
    ),
    history: value.history.filter((item) => (previous.history[item.id] ?? -1) < item.savedAt),
  };
}
