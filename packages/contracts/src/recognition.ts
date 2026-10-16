import { z } from 'zod';
import { StationIdSchema } from './catalog.js';
import { SongIdentitySchema, StreamIdSchema } from './tracks.js';
export const CapabilitiesSchema = z.strictObject({
  recognition: z.enum(['disabled', 'available', 'quota-exhausted', 'unavailable']),
});
export const RecognitionRequestSchema = z.strictObject({ streamId: StreamIdSchema });
const base = z.strictObject({
  stationId: StationIdSchema,
  streamId: StreamIdSchema,
  source: z.literal('audd'),
  timing: z.literal('unknown'),
  retryAfter: z.number().int().min(1).max(86400).nullable(),
});
export const RecognitionResultSchema = z.discriminatedUnion('status', [
  base.extend({
    status: z.literal('found'),
    song: SongIdentitySchema,
    observedAt: z.iso.datetime(),
    reason: z.null(),
  }),
  base.extend({
    status: z.enum(['not-found', 'unavailable', 'busy', 'cooldown', 'quota-exhausted', 'error']),
    song: z.null(),
    observedAt: z.iso.datetime().nullable(),
    reason: z.enum(['disabled', 'unsupported-stream', 'provider-unavailable']).nullable(),
  }),
]);
export type RecognitionResult = z.infer<typeof RecognitionResultSchema>;
export type Capabilities = z.infer<typeof CapabilitiesSchema>;
