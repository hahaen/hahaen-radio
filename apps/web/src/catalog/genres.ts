import { GenreSchema } from '@haen/contracts';

export const BROWSABLE_GENRES = GenreSchema.options.filter((genre) => genre !== 'religious');

export function normalizeGenreSelection<T extends string>(genres: T[] | null): T[] | null {
  if (genres === null) return null;
  const remaining = genres.filter((genre) => genre !== 'religious');
  return genres.length > 0 && remaining.length === 0 ? null : remaining;
}
