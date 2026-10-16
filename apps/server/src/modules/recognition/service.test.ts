import { expect, it, vi } from 'vitest';
import { normalizeStation } from '../catalog/normalize.js';
import { prepareSnapshot } from '../catalog/snapshot.js';
import { createCatalogService } from '../catalog/service.js';
import { testRepository } from '../../testing/catalog-repository.js';
import type { RecognitionSample } from '../../integrations/recognition-sample.js';
import { RecognitionProviderError } from '../../integrations/audd.js';
import { createRecognitionService } from './service.js';
const stations = [1, 2].map((index) =>
  normalizeStation({
    stationuuid: '00000000-0000-4000-8000-' + String(index).padStart(12, '0'),
    name: 'Unit ' + index,
    url: 'https://radio.example/' + index,
    lastcheckok: 1,
  })!,
);
const catalog = () => createCatalogService(testRepository(prepareSnapshot(stations, [])));
const clip: RecognitionSample = { bytes: new Uint8Array(20000), type: 'audio/mpeg' };
it('never calls the paid provider after allowance persistence fails', async () => {
  const quota = allowance(),
    identify = vi.fn(async () => null);
  quota.reserve.mockRejectedValueOnce(new Error('storage unavailable'));
  const service = createRecognitionService(catalog(), {
    token: 'unit-only-token',
    quota,
    sample: async () => clip,
    identify,
  });
  try {
    expect((await service.recognize(stations[0]!.id, stations[0]!.streams[0]!.id)).status).toBe(
      'error',
    );
    expect(identify).not.toHaveBeenCalled();
  } finally {
    await service.close();
  }
});
function allowance(limit = 2) {
  let used = 0,
    closed = false;
  return {
    get available() {
      return !closed;
    },
    get exhausted() {
      return used >= limit;
    },
    reserve: vi.fn(async () => {
      if (used >= limit) return false;
      used++;
      return true;
    }),
    close: vi.fn(async () => {
      closed = true;
    }),
  };
}
it('keeps the default disabled path free of catalogue, sample and provider requests', async () => {
  const source = { station: vi.fn() },
    service = createRecognitionService(source);
  expect(service.capability()).toBe('disabled');
  expect((await service.recognize(stations[0]!.id, stations[0]!.streams[0]!.id)).reason).toBe(
    'disabled',
  );
  expect(source.station).not.toHaveBeenCalled();
  await service.close();
});
it('merges subscribers, preserves a surviving caller after cancellation and caches the last allowed result without charging twice', async () => {
  let finish!: (value: RecognitionSample) => void;
  const quota = allowance(1),
    sample = vi.fn(
      () =>
        new Promise<RecognitionSample>((resolve) => {
          finish = resolve;
        }),
    ),
    identify = vi.fn(async () => ({ artist: 'Artist', title: 'Song' }));
  const service = createRecognitionService(catalog(), {
    token: 'unit-only-token',
    quota,
    sample,
    identify,
  });
  const first = stations[0]!,
    second = stations[1]!,
    abort = new AbortController();
  try {
    const a = service
        .recognize(first.id, first.streams[0]!.id, abort.signal)
        .catch((error) => error.name),
      b = service.recognize(first.id, first.streams[0]!.id);
    await vi.waitFor(() => expect(sample).toHaveBeenCalledOnce());
    expect((await service.recognize(second.id, second.streams[0]!.id)).status).toBe('busy');
    abort.abort();
    expect(await a).toBe('AbortError');
    finish(clip);
    expect((await b).status).toBe('found');
    expect((await service.recognize(first.id, first.streams[0]!.id)).status).toBe('found');
    expect(service.capability()).toBe('quota-exhausted');
    expect((await service.recognize(second.id, second.streams[0]!.id)).status).toBe(
      'quota-exhausted',
    );
    expect(quota.reserve).toHaveBeenCalledOnce();
    expect(identify).toHaveBeenCalledOnce();
  } finally {
    await service.close();
  }
});
it('cancels an abandoned sample before reserving allowance and never uploads it', async () => {
  const quota = allowance(),
    sample = vi.fn(
      (_url: string, signal: AbortSignal) =>
        new Promise<RecognitionSample>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    ),
    identify = vi.fn(async () => null);
  const service = createRecognitionService(catalog(), {
    token: 'unit-only-token',
    quota,
    sample,
    identify,
  });
  const abort = new AbortController();
  const request = service
    .recognize(stations[0]!.id, stations[0]!.streams[0]!.id, abort.signal)
    .catch((error) => error.name);
  await vi.waitFor(() => expect(sample).toHaveBeenCalledOnce());
  abort.abort();
  expect(await request).toBe('AbortError');
  await service.close();
  expect(quota.reserve).not.toHaveBeenCalled();
  expect(identify).not.toHaveBeenCalled();
});
it('consumes uncertain provider attempts conservatively, enforces global cooldown and skips unsupported samples', async () => {
  let now = 0;
  const quota = allowance(),
    sample = vi.fn(async () => clip),
    identify = vi.fn(async () => {
      throw new RecognitionProviderError('cooldown', 120);
    });
  const service = createRecognitionService(catalog(), {
    token: 'unit-only-token',
    quota,
    sample,
    identify,
    now: () => now,
  });
  try {
    expect((await service.recognize(stations[0]!.id, stations[0]!.streams[0]!.id)).status).toBe(
      'cooldown',
    );
    now = 10000;
    expect((await service.recognize(stations[1]!.id, stations[1]!.streams[0]!.id)).retryAfter).toBe(
      110,
    );
    expect(quota.reserve).toHaveBeenCalledOnce();
    expect(sample).toHaveBeenCalledOnce();
  } finally {
    await service.close();
  }
  const another = allowance(),
    unsupported = createRecognitionService(catalog(), {
      token: 'unit-only-token',
      quota: another,
      sample: async () => null,
      identify,
    });
  try {
    expect((await unsupported.recognize(stations[0]!.id, stations[0]!.streams[0]!.id)).reason).toBe(
      'unsupported-stream',
    );
    expect(another.reserve).not.toHaveBeenCalled();
  } finally {
    await unsupported.close();
  }
});
