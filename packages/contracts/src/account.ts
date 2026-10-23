import { z } from 'zod';
import { StationIdSchema } from './catalog.js';

export const isReservedUsername = (username: string) =>
  /^(test|admin|administrator|root|system|guest|support|service|security|moderator|webmaster|haen|api|www|null|undefined)/i.test(
    username,
  );

export const AccountCredentialsSchema = z.strictObject({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{3,32}$/),
  password: z.string().min(6).max(128),
});
export const AccountUserSchema = z.strictObject({ id: z.uuid(), username: z.string() });
export type AccountUser = z.infer<typeof AccountUserSchema>;
export const AccountSessionSchema = z.strictObject({ user: AccountUserSchema.nullable() });
const savedAt = z.number().int().nonnegative().max(8640000000000000);
export const CollectionStationSchema = z.strictObject({
  id: StationIdSchema.toLowerCase(),
  name: z.string().trim().min(1).max(512),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable(),
  savedAt,
});
export const CollectionSongSchema = z.strictObject({
  artist: z.string().trim().min(1).max(512),
  title: z.string().trim().min(1).max(512),
  savedAt,
});
export const collectionSongKey = (song: { artist: string; title: string }) =>
  JSON.stringify(
    [song.artist, song.title].map((value) =>
      value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase(),
    ),
  );
export const AccountCollectionSchema = z
  .strictObject({
    favorites: z.array(CollectionStationSchema).max(5000),
    songs: z.array(CollectionSongSchema).max(5000),
    history: z.array(CollectionStationSchema).max(100),
  })
  .superRefine((value, context) => {
    for (const kind of ['favorites', 'history'] as const)
      if (new Set(value[kind].map((item) => item.id)).size !== value[kind].length)
        context.addIssue({ code: 'custom', message: 'Duplicate station', path: [kind] });
    if (new Set(value.songs.map(collectionSongKey)).size !== value.songs.length)
      context.addIssue({ code: 'custom', message: 'Duplicate song', path: ['songs'] });
  });
export type AccountCollection = z.infer<typeof AccountCollectionSchema>;
export const emptyCollection = (): AccountCollection => ({ favorites: [], songs: [], history: [] });
export const AccountLibrarySchema = z.strictObject({
  revision: z.number().int().nonnegative().max(2147483646),
  collection: AccountCollectionSchema,
});
export type AccountLibrary = z.infer<typeof AccountLibrarySchema>;
export const SaveAccountLibrarySchema = AccountLibrarySchema.extend({ userId: z.uuid() });
export const AccountOwnerSchema = z.strictObject({ userId: z.uuid() });
