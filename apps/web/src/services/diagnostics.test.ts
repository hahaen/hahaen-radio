import { afterEach, expect, it, vi } from 'vitest';
import { sendPlaybackReport } from './diagnostics';
afterEach(() => vi.unstubAllGlobals());
const stationId = '00000000-0000-4000-8000-000000000001',
  input = {
    reportId: '00000000-0000-4000-8000-000000000011',
    streamId: 'a'.repeat(24),
    failure: 'network' as const,
  };
it('sends only the validated report body and handles limited and unavailable DTOs on their real HTTP statuses', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(JSON.stringify({ status: 'limited', retryAfter: 60 }), { status: 429 }),
  );
  vi.stubGlobal('fetch', fetch);
  expect(await sendPlaybackReport(stationId, input, new AbortController().signal)).toEqual({
    status: 'limited',
    retryAfter: 60,
  });
  const options = fetch.mock.calls[0]!;
  expect(options[0]).toBe(`/api/v1/stations/${stationId}/playback-reports`);
  expect(JSON.parse(String(options[1]!.body))).toEqual(input);
  fetch.mockResolvedValueOnce(
    new Response('{"status":"unavailable","retryAfter":null}', { status: 503 }),
  );
  expect((await sendPlaybackReport(stationId, input, new AbortController().signal)).status).toBe(
    'unavailable',
  );
});
it('rejects a receipt with the wrong identity or a DTO carried on the wrong HTTP status', async () => {
  const receipt = {
    status: 'accepted',
    reportId: input.reportId,
    stationId,
    streamId: input.streamId,
    expiresAt: '2026-10-24T00:00:00Z',
  };
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ ...receipt, streamId: 'b'.repeat(24) }), { status: 202 }),
  );
  vi.stubGlobal('fetch', fetch);
  await expect(sendPlaybackReport(stationId, input, new AbortController().signal)).rejects.toThrow(
    'DIAGNOSTIC_IDENTITY_MISMATCH',
  );
  fetch.mockResolvedValueOnce(new Response(JSON.stringify(receipt), { status: 429 }));
  await expect(sendPlaybackReport(stationId, input, new AbortController().signal)).rejects.toThrow(
    'DIAGNOSTIC_STATUS_MISMATCH',
  );
});
