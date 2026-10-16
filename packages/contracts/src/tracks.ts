import { z } from 'zod';
import { StationIdSchema } from './catalog.js';
export const StreamIdSchema = z.string().regex(/^[a-f0-9]{24}$/);
export const SongIdentitySchema = z.strictObject({
  artist: z.string().trim().min(1).max(512),
  title: z.string().trim().min(1).max(512),
});
export const NowPlayingSchema = z.strictObject({
  stationId: StationIdSchema,
  streamId: StreamIdSchema,
  status: z.enum(['available', 'unavailable', 'error', 'busy']),
  source: z.literal('station-icy'),
  observedAt: z.iso.datetime(),
  rawTitle: z.string().max(1024).nullable(),
  song: SongIdentitySchema.nullable(),
  timing: z.literal('unknown'),
  retryAfter: z.number().int().min(1).max(86400),
});
export const LyricsQuerySchema = SongIdentitySchema;
export const LyricLineSchema = z.strictObject({
  at: z.number().min(0).max(21600),
  text: z.string().max(2048),
});
export const LyricsRecordSchema = z.strictObject({
  id: z.number().int().positive(),
  artist: z.string().min(1).max(512),
  title: z.string().min(1).max(512),
  album: z.string().max(512),
  duration: z.number().min(0).max(21600),
  instrumental: z.boolean(),
  plain: z.string().max(65536).nullable(),
  lines: z.array(LyricLineSchema).max(2000),
});
export const LyricsResultSchema = z.strictObject({
  source: z.literal('lrclib'),
  status: z.enum(['found', 'not-found', 'unavailable', 'busy', 'rate-limited']),
  items: z.array(LyricsRecordSchema).max(8),
  retryAfter: z.number().int().min(1).max(86400).nullable(),
});
export type SongIdentity = z.infer<typeof SongIdentitySchema>;
export type NowPlaying = z.infer<typeof NowPlayingSchema>;
export type LyricsRecord = z.infer<typeof LyricsRecordSchema>;
export type LyricsResult = z.infer<typeof LyricsResultSchema>;
