import { expect, it, vi } from 'vitest';
import { mkdtemp, chmod, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RecognitionResultSchema } from '@haen/contracts';
import { buildApp } from '../../app.js';
import { readEnvironment } from '../../config/environment.js';
import { normalizeStation } from '../catalog/normalize.js';
import { prepareSnapshot } from '../catalog/snapshot.js';
import { createCatalogService } from '../catalog/service.js';
import { testRepository } from '../../testing/catalog-repository.js';
import { createRecognitionService } from './service.js';
import { openRecognitionQuota } from './quota.js';
const station = normalizeStation({
  stationuuid: '00000000-0000-4000-8000-000000000001',
  name: 'Unit',
  url: 'https://radio.example/live',
  lastcheckok: 1,
})!;
const path = `/api/v1/stations/${station.id}/recognition`;
it('aborts active work before draining HTTP requests and releases the persisted allowance on graceful shutdown', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'haen-recognition-shutdown-'));
  await chmod(directory, 0o700);
  const config = {
    enabled: true as const,
    token: 'unit-only-token',
    limit: 1,
    budgetId: 'shutdown-fixture',
    statePath: join(directory, 'quota.json'),
  };
  const quota = await openRecognitionQuota(config, true);
  const catalog = createCatalogService(testRepository(prepareSnapshot([station], [])));
  let samplingSignal: AbortSignal | undefined;
  const sample = vi.fn(
    (_url: string, signal: AbortSignal) =>
      new Promise<null>((_resolve, reject) => {
        samplingSignal = signal;
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  );
  const identify = vi.fn(async () => null);
  const recognition = createRecognitionService(catalog, {
    token: config.token,
    quota,
    sample,
    identify,
  });
  const app = buildApp(readEnvironment({}), false, catalog, { recognition });
  try {
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const pending = fetch(address + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ streamId: station.streams[0]!.id }),
    }).then((reply) => reply.json());
    await vi.waitFor(() => expect(sample).toHaveBeenCalledOnce());
    const closing = app.close();
    await vi.waitFor(() => expect(samplingSignal?.aborted).toBe(true));
    expect(RecognitionResultSchema.parse(await pending).status).toBe('error');
    await closing;
    expect(identify).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(config.statePath, 'utf8')).used).toBe(0);
    await expect(access(config.statePath + '.lock')).rejects.toThrow();
    const reopened = await openRecognitionQuota(config);
    try {
      await recognition.close();
      await access(config.statePath + '.lock');
      expect(reopened.available).toBe(true);
    } finally {
      await reopened.close();
    }
  } finally {
    await app.close();
    await quota.close();
    await rm(directory, { recursive: true, force: true });
  }
});
it('cancels the last real HTTP caller before reserving allowance or uploading a sample', async () => {
  const catalog = createCatalogService(testRepository(prepareSnapshot([station], [])));
  const reserve = vi.fn(async () => true),
    identify = vi.fn(async () => null);
  let samplingSignal: AbortSignal | undefined;
  const sample = vi.fn(
    (_url: string, signal: AbortSignal) =>
      new Promise<null>((_resolve, reject) => {
        samplingSignal = signal;
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  );
  const recognition = createRecognitionService(catalog, {
    token: 'unit-only-token',
    quota: { available: true, exhausted: false, reserve, close: async () => {} },
    sample,
    identify,
  });
  const app = buildApp(readEnvironment({}), false, catalog, { recognition });
  try {
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const abort = new AbortController();
    const pending = fetch(address + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ streamId: station.streams[0]!.id }),
      signal: abort.signal,
    }).catch((error) => error.name);
    await vi.waitFor(() => expect(sample).toHaveBeenCalledOnce());
    abort.abort();
    expect(await pending).toBe('AbortError');
    await vi.waitFor(() => expect(samplingSignal?.aborted).toBe(true));
    expect(reserve).not.toHaveBeenCalled();
    expect(identify).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
it('serializes an actual service match with sample provenance and reuses it without a second reservation', async () => {
  const catalog = createCatalogService(testRepository(prepareSnapshot([station], [])));
  const reserve = vi.fn(async () => true),
    identify = vi.fn(async () => ({ artist: 'API Artist', title: 'API Song' }));
  const recognition = createRecognitionService(catalog, {
    token: 'unit-only-token',
    quota: { available: true, exhausted: false, reserve, close: async () => {} },
    sample: async () => ({ bytes: new Uint8Array(20000), type: 'audio/mpeg' }),
    identify,
  });
  const app = buildApp(readEnvironment({}), false, catalog, { recognition });
  try {
    for (let index = 0; index < 2; index++) {
      const reply = await app.inject({
        method: 'POST',
        url: path,
        payload: { streamId: station.streams[0]!.id },
      });
      expect(reply.statusCode).toBe(200);
      expect(RecognitionResultSchema.parse(reply.json())).toMatchObject({
        status: 'found',
        source: 'audd',
        timing: 'unknown',
        song: { artist: 'API Artist', title: 'API Song' },
      });
    }
    expect(reserve).toHaveBeenCalledOnce();
    expect(identify).toHaveBeenCalledOnce();
  } finally {
    await app.close();
  }
});
it('exposes a disabled capability and validated unavailable response without requesting a provider', async () => {
  const app = buildApp(readEnvironment({}), false);
  try {
    expect((await app.inject('/api/v1/capabilities')).json()).toEqual({ recognition: 'disabled' });
    const reply = await app.inject({
      method: 'POST',
      url: path,
      payload: { streamId: station.streams[0]!.id },
    });
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['cache-control']).toBe('no-store');
    expect(RecognitionResultSchema.parse(reply.json())).toMatchObject({
      status: 'unavailable',
      reason: 'disabled',
      song: null,
    });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: path,
          payload: { streamId: station.streams[0]!.id, url: 'https://127.0.0.1/' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: path,
          headers: { 'sec-fetch-site': 'cross-site' },
          payload: { streamId: station.streams[0]!.id },
        })
      ).statusCode,
    ).toBe(400);
    await app.ready();
    expect(app.swagger().paths?.['/api/v1/stations/{id}/recognition']).toBeDefined();
  } finally {
    await app.close();
  }
});
it('checks catalogue ownership before sampling and publishes no token or allowance internals', async () => {
  const catalog = createCatalogService(testRepository(prepareSnapshot([station], []))),
    sample = vi.fn(async () => null),
    reserve = vi.fn(async () => true);
  const recognition = createRecognitionService(catalog, {
    token: 'unit-only-token',
    quota: { available: true, exhausted: false, reserve, close: async () => {} },
    sample,
  });
  const app = buildApp(readEnvironment({}), false, catalog, { recognition });
  try {
    const missing = await app.inject({
      method: 'POST',
      url: path,
      payload: { streamId: 'f'.repeat(24) },
    });
    expect(missing.statusCode).toBe(404);
    expect(sample).not.toHaveBeenCalled();
    const valid = await app.inject({
      method: 'POST',
      url: path,
      payload: { streamId: station.streams[0]!.id },
    });
    expect(RecognitionResultSchema.parse(valid.json()).reason).toBe('unsupported-stream');
    expect(valid.body).not.toContain('unit-only-token');
    expect(reserve).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
