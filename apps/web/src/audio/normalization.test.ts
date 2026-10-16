import { afterEach, expect, it, vi } from 'vitest';
import { attenuation, LoudnessNormalizer, sampleAttenuation } from './normalization';
import type { StreamCandidate } from '@haen/contracts';
const stream: StreamCandidate = {
  id: 'a'.repeat(24),
  url: 'https://media.example/tone.mp3',
  hls: false,
  codec: 'MP3',
  bitrate: 128,
  analysis: 'unknown',
};
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('uses a bounded attenuation and never raises quiet or silent samples', () => {
  expect(attenuation([new Float32Array(100).fill(0.14)])).toBeCloseTo(0.5);
  expect(attenuation([new Float32Array(100).fill(0.01)])).toBe(1);
  expect(attenuation([new Float32Array(100)])).toBeNull();
  expect(attenuation([new Float32Array([NaN])])).toBeNull();
  expect(attenuation([new Float32Array(100).fill(1)])).toBe(0.15);
});
it('never overlaps a pending decoder and drops a late result after switching or stopping', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('OfflineAudioContext', class {});
  let finish: (value: number | null) => void = () => {};
  const sample = vi.fn(
      () =>
        new Promise<number | null>((resolve) => {
          finish = resolve;
        }),
    ),
    output = vi.fn();
  const normalizer = new LoudnessNormalizer(output, sample);
  normalizer.start(stream);
  await Promise.resolve();
  normalizer.start({ ...stream, id: 'b'.repeat(24), url: 'https://media.example/next.mp3' });
  await vi.advanceTimersByTimeAsync(1000);
  expect(sample).toHaveBeenCalledOnce();
  finish(0.2);
  await vi.advanceTimersByTimeAsync(500);
  expect(sample).toHaveBeenCalledTimes(2);
  expect(output).not.toHaveBeenCalledWith(0.2, 'active');
  normalizer.stop();
  finish(0.3);
  await vi.advanceTimersByTimeAsync(1000);
  expect(output).not.toHaveBeenCalledWith(0.3, 'active');
  expect(vi.getTimerCount()).toBe(0);
});
it('stops failed analysis without affecting playback or repeatedly retrying it', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('OfflineAudioContext', class {});
  const output = vi.fn(),
    sample = vi.fn(async () => {
      throw new Error('CORS');
    }),
    normalizer = new LoudnessNormalizer(output, sample);
  normalizer.start(stream);
  await vi.advanceTimersByTimeAsync(1);
  expect(output).toHaveBeenLastCalledWith(1, 'unavailable');
  await vi.advanceTimersByTimeAsync(60000);
  expect(sample).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  normalizer.stop();
});
it('does not probe a denied or unsupported HLS source', () => {
  vi.stubGlobal('OfflineAudioContext', class {});
  const sample = vi.fn(async () => 0.4),
    output = vi.fn(),
    normalizer = new LoudnessNormalizer(output, sample);
  normalizer.start({ ...stream, analysis: 'denied' });
  normalizer.start({ ...stream, hls: true });
  expect(sample).not.toHaveBeenCalled();
  expect(output).toHaveBeenLastCalledWith(1, 'unavailable');
  normalizer.stop();
});
it('bounds CORS sample bytes and cancels the response', async () => {
  const decode = vi.fn(async () => ({
    length: 100,
    duration: 1,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array(100).fill(0.14),
  }));
  vi.stubGlobal(
    'OfflineAudioContext',
    class {
      decodeAudioData = decode;
    },
  );
  const cancel = vi.fn(async () => {}),
    reader = {
      read: vi.fn().mockResolvedValue({ done: false, value: new Uint8Array(100000) }),
      cancel,
    };
  const fetch = vi.fn(async () => ({
    ok: true,
    headers: new Headers({ 'content-type': 'audio/mpeg' }),
    body: { getReader: () => reader },
  }));
  vi.stubGlobal('fetch', fetch);
  const abort = new AbortController();
  expect(await sampleAttenuation(stream.url, abort.signal)).toBeCloseTo(0.5);
  expect((decode.mock.calls[0] as unknown as [ArrayBuffer])[0].byteLength).toBe(65536);
  expect(cancel).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0]).toEqual([
    stream.url,
    expect.objectContaining({ mode: 'cors', credentials: 'omit', redirect: 'error' }),
  ]);
});

it('keeps the sampling cooldown across repeated buffering recoveries on the same stream', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('OfflineAudioContext', class {});
  const sample = vi.fn(async () => 0.5),
    normalizer = new LoudnessNormalizer(vi.fn(), sample);
  normalizer.start(stream);
  await vi.advanceTimersByTimeAsync(1);
  for (let index = 0; index < 5; index++) {
    normalizer.stop('waiting');
    normalizer.start(stream);
    await vi.advanceTimersByTimeAsync(1000);
  }
  expect(sample).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(30000);
  expect(sample).toHaveBeenCalledTimes(2);
  normalizer.stop();
});
