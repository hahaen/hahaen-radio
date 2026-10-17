import { z } from 'zod';
import { StationIdSchema } from './catalog.js';
import { StreamIdSchema } from './tracks.js';

export const PlaybackFailureSchema = z.enum([
  'network',
  'timeout',
  'unsupported',
  'unavailable',
  'offline',
]);
export const PlaybackReportRequestSchema = z.strictObject({
  reportId: z.uuid().transform((value) => value.toLowerCase()),
  streamId: StreamIdSchema,
  failure: PlaybackFailureSchema,
});
export const PlaybackReportResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('accepted'),
    reportId: z.uuid(),
    stationId: StationIdSchema,
    streamId: StreamIdSchema,
    expiresAt: z.iso.datetime(),
  }),
  z.strictObject({ status: z.literal('limited'), retryAfter: z.number().int().min(1).max(86400) }),
  z.strictObject({ status: z.literal('unavailable'), retryAfter: z.null() }),
]);
export type PlaybackReportRequest = z.infer<typeof PlaybackReportRequestSchema>;
export type PlaybackReportResult = z.infer<typeof PlaybackReportResultSchema>;
