import {
  AccountCollectionSchema,
  collectionSongKey,
  type AccountCollection,
} from '@haen/contracts';
import type { LibraryState } from '../library/store';
export const collectionOf = (state: LibraryState): AccountCollection => ({
  favorites: state.favorites,
  songs: state.songs,
  history: state.history,
});
const canonical = (value: AccountCollection) =>
  JSON.stringify({
    favorites: [...value.favorites].sort((a, b) => a.id.localeCompare(b.id)),
    songs: [...value.songs].sort((a, b) =>
      collectionSongKey(a).localeCompare(collectionSongKey(b)),
    ),
    history: [...value.history].sort((a, b) => a.id.localeCompare(b.id)),
  });
export const sameCollection = (a: AccountCollection, b: AccountCollection) =>
  canonical(a) === canonical(b);
function mergeItems<T extends { savedAt: number }>(
  base: T[],
  local: T[],
  remote: T[],
  key: (item: T) => string,
) {
  const previous = new Map(base.map((item) => [key(item), item]));
  const changed = new Map(local.map((item) => [key(item), item]));
  const result = new Map(remote.map((item) => [key(item), item]));
  for (const id of previous.keys()) if (!changed.has(id)) result.delete(id);
  for (const [id, item] of changed) {
    if (JSON.stringify(item) !== JSON.stringify(previous.get(id))) {
      const existing = result.get(id);
      result.set(id, existing && existing.savedAt > item.savedAt ? existing : item);
    }
  }
  return [...result.values()].sort(
    (a, b) => b.savedAt - a.savedAt || key(a).localeCompare(key(b), 'en'),
  );
}
export function mergeCollection(
  base: AccountCollection,
  local: AccountCollection,
  remote: AccountCollection,
): AccountCollection {
  return AccountCollectionSchema.parse({
    favorites: mergeItems(base.favorites, local.favorites, remote.favorites, (item) => item.id),
    songs: mergeItems(base.songs, local.songs, remote.songs, collectionSongKey),
    history: mergeItems(base.history, local.history, remote.history, (item) => item.id).slice(
      0,
      100,
    ),
  });
}
