import { afterEach, expect, it, vi } from 'vitest';
import { TuningSound } from './tuning';
afterEach(() => vi.unstubAllGlobals());
function environment() {
  const parameter = () => ({
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });
  const tones: {
    onended: (() => void) | null;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    frequency: ReturnType<typeof parameter>;
    type: string;
  }[] = [];
  const close = vi.fn(async () => {});
  vi.stubGlobal(
    'AudioContext',
    class {
      state = 'running';
      currentTime = 0;
      destination = {};
      close = close;
      resume = vi.fn(async () => {});
      createGain() {
        return { gain: parameter(), connect: vi.fn(), disconnect: vi.fn() };
      }
      createOscillator() {
        const tone = {
          onended: null,
          start: vi.fn(),
          stop: vi.fn(),
          disconnect: vi.fn(),
          connect: vi.fn(),
          frequency: parameter(),
          type: '',
        };
        tones.push(tone);
        return tone;
      }
    },
  );
  return { tones, close };
}
it('plays a short optional tone, replaces old nodes and closes the context', () => {
  const { tones, close } = environment(),
    sound = new TuningSound();
  sound.play(0.5, false);
  expect(tones).toHaveLength(0);
  sound.activate();
  sound.play(0.5, false);
  expect(tones).toHaveLength(1);
  expect(tones[0]!.stop).toHaveBeenCalledWith(0.11);
  sound.play(0.5, false);
  expect(tones[0]!.disconnect).toHaveBeenCalledOnce();
  sound.stop();
  expect(tones[1]!.disconnect).toHaveBeenCalledOnce();
  sound.destroy();
  expect(close).toHaveBeenCalledOnce();
});
it('does not synthesize sound while muted or at zero volume', () => {
  const { tones } = environment(),
    sound = new TuningSound();
  sound.activate();
  sound.play(1, true);
  sound.play(0, false);
  expect(tones).toHaveLength(0);
  sound.destroy();
});

it('suspends a deferred resume and discards its tone after pause', async () => {
  const pending: (() => void)[] = [];
  const oscillator = vi.fn();
  const context = {
    state: 'suspended',
    resume: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          pending.push(() => {
            context.state = 'running';
            resolve();
          });
        }),
    ),
    suspend: vi.fn(async () => {
      context.state = 'suspended';
    }),
    close: vi.fn(async () => {}),
    createOscillator: oscillator,
  };
  vi.stubGlobal(
    'AudioContext',
    class {
      constructor() {
        return context;
      }
    },
  );
  const sound = new TuningSound();
  sound.activate();
  sound.play(0.2, false);
  sound.pause();
  pending.forEach((finish) => finish());
  await Promise.resolve();
  await Promise.resolve();
  expect(context.suspend).toHaveBeenCalled();
  expect(oscillator).not.toHaveBeenCalled();
  sound.destroy();
});

it('plays the next station tone after overlapping suspension completes instead of leaving the resumed graph pending', async () => {
  const waiting: (() => void)[] = [];
  let suspending = 0;
  const start = vi.fn();
  const parameter = {
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
  };
  const context = {
    state: 'running' as AudioContextState,
    currentTime: 0,
    destination: {},
    resume: () => {
      // A resume during the observed unfinished graph suspension can remain pending.
      if (suspending) return new Promise<void>(() => {});
      context.state = 'running';
      return Promise.resolve();
    },
    suspend: () => {
      suspending++;
      return new Promise<void>((resolve) =>
        waiting.push(() => {
          context.state = 'suspended';
          suspending--;
          resolve();
        }),
      );
    },
    close: async () => {
      context.state = 'closed';
    },
    createOscillator: () => ({
      frequency: parameter,
      connect() {},
      disconnect() {},
      start,
      stop() {},
      onended: null,
      type: 'sine',
    }),
    createGain: () => ({ gain: parameter, connect() {}, disconnect() {} }),
  };
  vi.stubGlobal(
    'AudioContext',
    class {
      constructor() {
        return context;
      }
    },
  );
  const sound = new TuningSound();
  try {
    sound.activate();
    sound.pause();
    await Promise.resolve();
    await Promise.resolve();
    waiting.shift()!();
    sound.activate();
    sound.play(0.2, false);
    waiting.splice(0).forEach((finish) => finish());
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce(), { timeout: 200 });
    expect(context.state).toBe('running');
  } finally {
    sound.destroy();
  }
});
