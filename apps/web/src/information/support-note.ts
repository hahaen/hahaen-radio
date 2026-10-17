import { StationIdSchema, StreamIdSchema, PlaybackFailureSchema } from '@haen/contracts';
import type { PlaybackSnapshot } from '../audio/engine';

export type SupportContext = Pick<
  PlaybackSnapshot,
  'stationId' | 'streamId' | 'status' | 'failure'
>;

export function supportNote(context: SupportContext, language: string, now = new Date()) {
  const station = StationIdSchema.safeParse(context.stationId);
  const stream = StreamIdSchema.safeParse(context.streamId);
  return JSON.stringify(
    {
      application: 'HAEN',
      observedAt: now.toISOString(),
      interfaceLanguage: language === 'en' ? 'en' : 'zh',
      stationId: station.success ? station.data.toLowerCase() : null,
      streamId: stream.success ? stream.data : null,
      playback: context.status,
      failure: context.failure,
    },
    null,
    2,
  );
}

export function reportableFailure(context: SupportContext) {
  const station = StationIdSchema.safeParse(context.stationId),
    stream = StreamIdSchema.safeParse(context.streamId),
    failure = PlaybackFailureSchema.safeParse(context.failure);
  return context.status === 'failed' && station.success && stream.success && failure.success
    ? { stationId: station.data.toLowerCase(), streamId: stream.data, failure: failure.data }
    : null;
}
