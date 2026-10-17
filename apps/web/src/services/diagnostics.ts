import { applicationPath } from '../platform/paths';
import {
  ApiErrorSchema,
  PlaybackReportRequestSchema,
  PlaybackReportResultSchema,
  StationIdSchema,
  type PlaybackReportRequest,
} from '@haen/contracts';
import { HttpError } from './http';
export async function sendPlaybackReport(
  id: string,
  input: PlaybackReportRequest,
  signal: AbortSignal,
) {
  const stationId = StationIdSchema.parse(id).toLowerCase(),
    body = PlaybackReportRequestSchema.parse(input);
  const response = await fetch(
    applicationPath(`api/v1/stations/${encodeURIComponent(stationId)}/playback-reports`),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    },
  );
  const value: unknown = await response.json().catch(() => null);
  if (![202, 429, 503].includes(response.status)) {
    const error = ApiErrorSchema.safeParse(value);
    throw new HttpError(response.status, error.success ? error.data.code : 'HTTP_ERROR');
  }
  const result = PlaybackReportResultSchema.parse(value);
  if (
    response.status !==
    (result.status === 'accepted' ? 202 : result.status === 'limited' ? 429 : 503)
  )
    throw new Error('DIAGNOSTIC_STATUS_MISMATCH');
  if (
    result.status === 'accepted' &&
    (result.stationId !== stationId ||
      result.streamId !== body.streamId ||
      result.reportId !== body.reportId)
  )
    throw new Error('DIAGNOSTIC_IDENTITY_MISMATCH');
  return result;
}
