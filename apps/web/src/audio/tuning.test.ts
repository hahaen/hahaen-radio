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
