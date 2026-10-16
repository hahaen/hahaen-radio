import { z } from 'zod';

export const GenreSchema = z.enum([
  'general',
  'pop',
  'news',
  'rock',
  'electronic',
  'world',
  'religious',
  'classical',
  'jazz',
  'folk',
  'hiphop',
]);
export const StationIdSchema = z.uuid();
export const AvailabilitySchema = z.enum(['available', 'unavailable', 'blocked', 'unknown']);
const PublicUrlSchema = z
  .string()
  .max(4096)
  .url()
  .regex(/^https:\/\//i)
  .refine((value) => !/^https:\/\/[^/?#]*@/i.test(value), 'Credentials are not permitted in URLs');
export const StreamCandidateSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{24}$/),
  url: PublicUrlSchema,
  hls: z.boolean(),
  codec: z.string().max(32).nullable(),
  bitrate: z.number().int().min(1).max(10000).nullable(),
  analysis: z.enum(['unknown', 'allowed', 'denied']),
});
export const StationSummarySchema = z.object({
  id: StationIdSchema,
  name: z.string().min(1).max(512),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable(),
  region: z.string().max(255).nullable(),
  city: z.string().max(255).nullable(),
  nearbyCity: z.string().max(255).nullable(),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  locationPrecision: z.enum(['coordinates', 'country', 'unknown']),
  timezone: z.string().max(64).nullable(),
  timezoneSource: z.enum(['geonames']).nullable(),
  genre: GenreSchema,
  tags: z.array(z.string().min(1).max(64)).max(64),
  languages: z.array(z.string().min(1).max(64)).max(32),
  bitrate: z.number().int().min(1).max(10000).nullable(),
  availability: AvailabilitySchema,
});
export const StationDetailSchema = StationSummarySchema.extend({
  homepage: PublicUrlSchema.nullable(),
  streams: z.array(StreamCandidateSchema).max(3),
});
export const CatalogManifestSchema = z.object({
  version: z.uuid(),
  createdAt: z.iso.datetime(),
  stationCount: z.number().int().nonnegative(),
  playableCount: z.number().int().nonnegative(),
  countryCount: z.number().int().nonnegative(),
  genres: z.array(z.object({ id: GenreSchema, count: z.number().int().nonnegative() })),
  languages: z.array(z.object({ id: z.string(), count: z.number().int().nonnegative() })),
  chunks: z.array(
    z.object({ index: z.number().int().nonnegative(), count: z.number().int().nonnegative() }),
  ),
});
export const StationPageSchema = z.object({
  items: z.array(StationSummarySchema),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
});
export const CatalogChunkSchema = z.object({
  version: z.uuid(),
  index: z.number().int().nonnegative(),
  items: z.array(StationSummarySchema).max(1000),
});
const commaList = z
  .string()
  .max(2048)
  .transform((value) =>
    value === '' ? [] : [...new Set(value.split(',').map((part) => part.trim().toLowerCase()))],
  );
export const StationSearchSchema = z.object({
  q: z.string().max(200).default(''),
  genres: commaList.pipe(z.array(GenreSchema).max(11)).optional(),
  languages: commaList.pipe(z.array(z.string().min(1).max(64)).max(32)).optional(),
  minBitrate: z.coerce
    .number()
    .pipe(z.union([z.literal(0), z.literal(128), z.literal(192), z.literal(320)]))
    .default(0),
  playableOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  excludeIds: commaList
    .pipe(z.array(StationIdSchema).max(32))
    .optional()
    .transform((value) => value ?? []),
  offset: z.coerce.number().int().min(0).max(200000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const StationLookupSchema = z.object({ ids: z.array(StationIdSchema).max(100) });
export const StationLookupResultSchema = z.object({
  items: z.array(StationDetailSchema).max(100),
  missing: z.array(StationIdSchema).max(100),
});
export const StreamListSchema = z.object({
  stationId: StationIdSchema,
  streams: z.array(StreamCandidateSchema).max(3),
});
export const ReadinessSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  database: z.boolean(),
  catalog: z.boolean(),
  version: z.uuid().nullable(),
});
export type StationSearch = z.output<typeof StationSearchSchema>;
export type Genre = z.infer<typeof GenreSchema>;
export type Availability = z.infer<typeof AvailabilitySchema>;
export type StreamCandidate = z.infer<typeof StreamCandidateSchema>;
export type StationSummary = z.infer<typeof StationSummarySchema>;
export type StationDetail = z.infer<typeof StationDetailSchema>;
export type CatalogManifest = z.infer<typeof CatalogManifestSchema>;
