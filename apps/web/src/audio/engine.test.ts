import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StreamCandidate } from '@haen/contracts';
import { AudioEngine } from './engine';
import type { HlsAdapter } from './hls-adapter';

const stream = (index: number, hls = false): StreamCandidate => ({
  id: String(index).padStart(24, '0'),
  url: `https://media.example/${index}.${hls ? 'm3u8' : 'mp3'}`,
  hls,
  codec: hls ? 'AAC' : 'MP3',
  bitrate: 128,
  analysis: 'unknown',
});
function harness(options: { loadHls?: () => Promise<HlsAdapter> } = {}) {
  const elements: HTMLAudioElement[] = [];
  const engine = new AudioEngine({
    ...options,
    createMedia: () => {
      const media = document.createElement('audio');
      vi.spyOn(media, 'play').mockResolvedValue();
      vi.spyOn(media, 'pause').mockImplementation(() => {});
      vi.spyOn(media, 'load').mockImplementation(() => {});
      vi.spyOn(media, 'remove');
      vi.spyOn(media, 'canPlayType').mockReturnValue('');
      elements.push(media);
      return media;
    },
  });
  const event = (name: string, media = elements.at(-1)!) => media.dispatchEvent(new Event(name));
  return { engine, elements, event };
}
afterEach(() => vi.useRealTimers());
describe('independent audio engine', () => {
  it('does not create a media resource until playback is requested and trusts real events', () => {
    const { engine, elements, event } = harness();
    engine.select('station-a', [stream(1)]);
    expect(elements).toHaveLength(0);
    expect(engine.getSnapshot().status).toBe('paused');
    engine.play();
    expect(engine.getSnapshot().status).toBe('connecting');
    event('playing');
    expect(engine.getSnapshot().status).toBe('playing');
    event('waiting');
    expect(engine.getSnapshot().status).toBe('buffering');
    engine.pause();
    expect(engine.getSnapshot().status).toBe('paused');
    event('playing');
    expect(engine.getSnapshot().status).toBe('paused');
    engine.destroy();
  });
  it('tries no more than three candidates, times each one out and supports an explicit retry', async () => {
    vi.useFakeTimers();
    const { engine, elements } = harness();
    engine.select('station-a', [stream(1), stream(2), stream(3), stream(4)], true);
    await vi.advanceTimersByTimeAsync(24001);
    expect(elements).toHaveLength(3);
    expect(engine.getSnapshot()).toMatchObject({
      status: 'failed',
      failure: 'timeout',
      attempt: 3,
    });
    await vi.advanceTimersByTimeAsync(60000);
    expect(elements).toHaveLength(3);
    engine.retry();
    expect(elements).toHaveLength(4);
    expect(engine.getSnapshot()).toMatchObject({ status: 'connecting', attempt: 1 });
    engine.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps buffered audio playing when a background network stall does not interrupt output', async () => {
    vi.useFakeTimers();
    const { engine, elements, event } = harness();
    engine.select('station-a', [stream(1)], true);
    const media = elements[0]!;
    Object.defineProperties(media, {
      paused: { configurable: true, value: false },
      readyState: { configurable: true, value: 4 },
    });
    event('playing');
    event('stalled');
    await vi.advanceTimersByTimeAsync(8001);
    expect(engine.getSnapshot().status).toBe('playing');
    expect(media.pause).not.toHaveBeenCalled();
    expect(media.getAttribute('src')).not.toBeNull();
    engine.destroy();
  });

  it('does not let a delayed buffering timeout tear down audio that has resumed', async () => {
    vi.useFakeTimers();
    const { engine, elements, event } = harness();
    engine.select('station-a', [stream(1)], true);
    const media = elements[0]!;
    Object.defineProperties(media, {
      paused: { configurable: true, value: false },
      readyState: { configurable: true, value: 2 },
    });
    event('playing');
    event('waiting');
    // Media playback can resume while the page's JS task queue is suspended.
    media.currentTime = 12;
    Object.defineProperty(media, 'readyState', { configurable: true, value: 4 });
    await vi.advanceTimersByTimeAsync(8001);
    expect(engine.getSnapshot().status).toBe('playing');
    expect(media.pause).not.toHaveBeenCalled();
    engine.destroy();
  });

  it.each([
    { readyState: 2, currentTime: 0 },
    { readyState: 2, currentTime: 12 },
    { readyState: 4, currentTime: 0 },
  ])(
    'still times out a stopped stream with $readyState readiness and $currentTime position',
    async (state) => {
      vi.useFakeTimers();
      const { engine, elements, event } = harness();
      engine.select('station-a', [stream(1)], true);
      const media = elements[0]!;
      Object.defineProperties(media, {
        paused: { configurable: true, value: false },
        readyState: { configurable: true, value: 2 },
      });
      event('playing');
      event('stalled');
      media.currentTime = state.currentTime;
      Object.defineProperty(media, 'readyState', { configurable: true, value: state.readyState });
      await vi.advanceTimersByTimeAsync(8001);
      expect(engine.getSnapshot()).toMatchObject({ status: 'failed', failure: 'timeout' });
      engine.destroy();
    },
  );
  it('ignores old media events and a late play rejection after a rapid switch', async () => {
    const { engine, elements, event } = harness();
    engine.select('station-a', [stream(1)]);
    engine.play();
    const old = elements[0]!;
    let reject: (error: Error) => void = () => {};
    vi.mocked(old.play).mockReturnValueOnce(
      new Promise((_resolve, failure) => {
        reject = failure;
      }),
    );
    engine.play();
    engine.select('station-b', [stream(2)], true);
    event('playing');
    reject(new DOMException('Superseded playback', 'AbortError'));
    event('error', old);
    event('playing', old);
    await Promise.resolve();
    expect(engine.getSnapshot()).toMatchObject({
      stationId: 'station-b',
      status: 'playing',
      attempt: 1,
    });
    expect(old.remove).toHaveBeenCalledOnce();
    expect(old.getAttribute('src')).toBeNull();
    engine.destroy();
  });
  it('preserves the current stream when a browser requires a new user gesture', async () => {
    const { engine, elements, event } = harness();
    engine.select('station-a', [stream(1), stream(2)]);
    engine.play();
    const media = elements[0]!;
    vi.mocked(media.play).mockRejectedValueOnce(
      new DOMException('Gesture required', 'NotAllowedError'),
    );
    engine.play();
    await Promise.resolve();
    expect(engine.getSnapshot().status).toBe('blocked');
    expect(elements).toHaveLength(1);
    engine.play();
    event('playing');
    expect(engine.getSnapshot().status).toBe('playing');
    engine.destroy();
  });
  it('honors system pause and offline failures without automatically resuming', async () => {
    vi.useFakeTimers();
    const { engine, elements, event } = harness();
    engine.select('station-a', [stream(1)], true);
    event('playing');
    event('pause');
    expect(engine.getSnapshot().status).toBe('paused');
    await vi.advanceTimersByTimeAsync(10000);
    expect(elements).toHaveLength(1);
    engine.play();
    engine.setOnline(false);
    expect(engine.getSnapshot()).toMatchObject({ status: 'failed', failure: 'offline' });
    engine.setOnline(true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(engine.getSnapshot().status).toBe('failed');
    engine.destroy();
  });
  it('does not attach a delayed HLS module after switching away', async () => {
    let resolve: (value: HlsAdapter) => void = () => {};
    const adapter: HlsAdapter = { supported: true, attach: vi.fn() };
    const { engine } = harness({
      loadHls: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    engine.select('station-hls', [stream(1, true)], true);
    engine.select('station-direct', [stream(2)], true);
    resolve(adapter);
    await Promise.resolve();
    expect(adapter.attach).not.toHaveBeenCalled();
    expect(engine.getSnapshot().stationId).toBe('station-direct');
    engine.destroy();
  });
  it('destroys failed HLS sessions and preserves volume and mute when moving to a backup', async () => {
    let callbacks: { ready(): void; error(): void } | undefined;
    const session = { destroy: vi.fn(), pause: vi.fn(), resume: vi.fn() };
    const { engine, elements, event } = harness({
      loadHls: async () => ({
        supported: true,
        attach: (_media, _url, handlers) => {
          callbacks = handlers;
          return session;
        },
      }),
    });
    engine.setVolume(0.3);
    engine.setMuted(true);
    engine.select('station-a', [stream(1, true), stream(2)], true);
    await Promise.resolve();
    callbacks!.ready();
    event('playing');
    engine.pause();
    expect(session.pause).toHaveBeenCalled();
    engine.play();
    expect(session.resume).toHaveBeenCalled();
    callbacks!.error();
    expect(session.destroy).toHaveBeenCalledOnce();
    expect(elements.at(-1)!.volume).toBe(0.3);
    expect(elements.at(-1)!.muted).toBe(true);
    expect(engine.getSnapshot().attempt).toBe(2);
    engine.destroy();
  });
});

it('keeps playback and reports unavailable when a device ignores calibrated output at full base volume', async () => {
  vi.stubGlobal(
    'OfflineAudioContext',
    class {
      async decodeAudioData() {
        return {
          length: 100,
          duration: 1,
          numberOfChannels: 1,
          getChannelData: () => new Float32Array(100).fill(0.28),
        };
      }
    },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(new Uint8Array([0]), {
          headers: { 'content-type': 'audio/wav' },
        }),
    ),
  );
  const { engine, elements, event } = harness();
  try {
    engine.setVolume(1);
    engine.setAudioOptions({ normalize: true, tuning: false });
    engine.select('station-a', [stream(1)], true);
    Object.defineProperty(elements[0]!, 'volume', {
      configurable: true,
      get: () => 1,
      set: () => {},
    });
    event('playing');
    await vi.waitFor(() => expect(engine.getSnapshot().normalization).toBe('unavailable'));
    expect(engine.getSnapshot()).toMatchObject({
      status: 'playing',
      volume: 1,
      volumeControllable: false,
    });
    expect(elements[0]!.volume).toBe(1);
  } finally {
    engine.destroy();
    vi.unstubAllGlobals();
  }
});

it('unlocks optional audio with the new volume and mute state but does not resume a paused context', () => {
  const resume = vi.fn(async () => {});
  vi.stubGlobal(
    'AudioContext',
    class {
      state = 'suspended';
      resume = resume;
      close = vi.fn(async () => {});
    },
  );
  const { engine } = harness();
  try {
    engine.setAudioOptions({ normalize: false, tuning: true });
    engine.setVolume(0);
    engine.select('station-a', [stream(1)], true);
    expect(resume).not.toHaveBeenCalled();
    engine.setVolume(0.2);
    expect(resume).toHaveBeenCalledOnce();
    engine.setMuted(true);
    engine.setMuted(false);
    expect(resume).toHaveBeenCalledTimes(2);
    engine.pause();
    engine.setVolume(0);
    engine.setVolume(0.2);
    engine.setMuted(true);
    engine.setMuted(false);
    expect(resume).toHaveBeenCalledTimes(2);
  } finally {
    engine.destroy();
    vi.unstubAllGlobals();
  }
});
