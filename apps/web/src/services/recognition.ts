import { CapabilitiesSchema, RecognitionResultSchema } from '@haen/contracts';
import { getJson } from './http';
export const getCapabilities = (signal?: AbortSignal) =>
  getJson('/capabilities', CapabilitiesSchema, signal);
export async function recognizeStation(stationId: string, streamId: string, signal: AbortSignal) {
  const result = await getJson(
    `/stations/${encodeURIComponent(stationId)}/recognition`,
    RecognitionResultSchema,
    signal,
    { method: 'POST', body: { streamId }, timeoutMs: 25000 },
  );
  if (result.stationId !== stationId || result.streamId !== streamId)
    throw new Error('RECOGNITION_IDENTITY_MISMATCH');
  return result;
}
