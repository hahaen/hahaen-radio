import { expect, it, vi } from 'vitest';
import { PlaybackReportResultSchema } from '@haen/contracts';
import { buildApp } from '../../app.js';
import { readEnvironment } from '../../config/environment.js';
import { createDiagnosticService } from './service.js';
import { normalizeStation } from '../catalog/normalize.js';
import { DiagnosticConflictError } from './repository.js';
const station = normalizeStation({
  stationuuid: '00000000-0000-4000-8000-000000000001',
  name: 'Unit',
  url: 'https://radio.example/live',
  lastcheckok: 1,
})!;
const path = `/api/v1/stations/${station.id}/playback-reports`,
  input = {
    reportId: '00000000-0000-4000-8000-000000000011',
    streamId: station.streams[0]!.id,
    failure: 'timeout' as const,
  };
it('validates ownership, a small strict body and cross-site rejection without accepting logs, URLs or identity fields', async () => {
  const record = vi.fn(async () => ({
    status: 'accepted' as const,
    reportId: input.reportId,
    stationId: station.id,
    streamId: input.streamId,
    expiresAt: '2026-10-24T00:00:00Z',
  }));
  const app = buildApp(readEnvironment({}), false, undefined, {
    diagnostics: createDiagnosticService({ station: async () => station }, { record }),
  });
  try {
    for (const payload of [
      { ...input, url: 'https://127.0.0.1/' },
      { ...input, log: 'arbitrary text' },
      { ...input, ip: '127.0.0.1' },
      { ...input, failure: 'anything' },
    ]) {
      expect((await app.inject({ method: 'POST', url: path, payload })).statusCode).toBe(400);
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: path,
          headers: { 'sec-fetch-site': 'cross-site' },
          payload: input,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: path,
          headers: { 'content-type': 'text/plain' },
          payload: 'plain',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: path,
          payload: { ...input, padding: 'x'.repeat(600) },
        })
      ).statusCode,
    ).toBe(413);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: path,
          payload: { ...input, streamId: 'f'.repeat(24) },
        })
      ).statusCode,
    ).toBe(404);
    expect(record).not.toHaveBeenCalled();
    const response = await app.inject({ method: 'POST', url: path, payload: input });
    expect(response.statusCode).toBe(202);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(PlaybackReportResultSchema.parse(response.json())).toMatchObject({
      status: 'accepted',
      reportId: input.reportId,
    });
    expect((await app.inject({ method: 'POST', url: path, payload: input })).json()).toEqual(
      response.json(),
    );
    expect(record).toHaveBeenCalledOnce();
    await app.ready();
    expect(app.swagger().paths?.['/api/v1/stations/{id}/playback-reports']).toBeDefined();
  } finally {
    await app.close();
  }
});
it('returns unavailable without a configured writer and refuses a reused receipt with conflicting data', async () => {
  const disabled = buildApp(readEnvironment({}), false);
  try {
    expect((await disabled.inject({ method: 'POST', url: path, payload: input })).statusCode).toBe(
      503,
    );
  } finally {
    await disabled.close();
  }
  const app = buildApp(readEnvironment({}), false, undefined, {
    diagnostics: createDiagnosticService(
      { station: async () => station },
      {
        record: async () => {
          throw new DiagnosticConflictError();
        },
      },
    ),
  });
  try {
    expect((await app.inject({ method: 'POST', url: path, payload: input })).statusCode).toBe(400);
  } finally {
    await app.close();
  }
});

it('does not begin a write after a real HTTP caller disconnects while catalogue lookup is pending', async () => {
  let finish!: (value: typeof station) => void,
    closed = false;
  const lookup = vi.fn(
    () =>
      new Promise<typeof station>((resolve) => {
        finish = resolve;
      }),
  );
  const record = vi.fn(async () => ({ status: 'unavailable' as const, retryAfter: null }));
  const app = buildApp(readEnvironment({}), false, undefined, {
    diagnostics: createDiagnosticService({ station: lookup }, { record }),
  });
  app.server.once('request', (_request, response) =>
    response.once('close', () => {
      closed = true;
    }),
  );
  try {
    const address = await app.listen({ host: '127.0.0.1', port: 0 }),
      abort = new AbortController();
    const pending = fetch(address + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: abort.signal,
    }).catch((error: Error) => error.name);
    await vi.waitFor(() => expect(lookup).toHaveBeenCalledOnce());
    abort.abort();
    expect(await pending).toBe('AbortError');
    await vi.waitFor(() => expect(closed).toBe(true));
    finish(station);
    await new Promise((resolve) => setImmediate(resolve));
    expect(record).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
