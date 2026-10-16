import type { StreamCandidate } from '@haen/contracts';
export type NormalizationStatus = 'off' | 'waiting' | 'active' | 'unavailable';
export function attenuation(samples: readonly Float32Array[]): number | null {
  let square = 0,
    count = 0;
  for (const channel of samples) {
    const stride = Math.max(1, Math.floor(channel.length / 24000));
    for (let index = 0; index < channel.length; index += stride) {
      const value = channel[index]!;
      if (!Number.isFinite(value)) return null;
      square += value * value;
      count++;
    }
  }
  const rms = Math.sqrt(square / Math.max(1, count));
  return rms > 0.0001 ? Math.max(0.15, Math.min(1, 0.07 / rms)) : null;
}
export async function sampleAttenuation(url: string, signal: AbortSignal): Promise<number | null> {
  const context = new OfflineAudioContext(1, 1, 48000);
  const request = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    request.abort();
  }, 4000);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    const response = await fetch(url, {
      mode: 'cors',
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.any([signal, request.signal]),
    });
    if (
      !response.ok ||
      !response.body ||
      !response.headers.get('content-type')?.toLowerCase().startsWith('audio/')
    )
      throw new Error('ANALYSIS_UNAVAILABLE');
    const reader = response.body.getReader();
    try {
      while (size < 65536) {
        const result = await reader.read();
        if (result.done) break;
        const bytes = result.value.subarray(0, 65536 - size);
        chunks.push(bytes);
        size += bytes.byteLength;
      }
    } catch (error) {
      if (!timedOut || signal.aborted || !size) throw error;
    } finally {
      void reader.cancel().catch(() => {});
    }
  } finally {
    request.abort();
    clearTimeout(timer);
  }
  signal.throwIfAborted();
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const buffer = await context.decodeAudioData(bytes.buffer);
  signal.throwIfAborted();
  if (!buffer.length || buffer.duration > 20 || buffer.numberOfChannels > 8) return null;
  return attenuation(
    Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index)),
  );
}
export class LoudnessNormalizer {
  private timer: ReturnType<typeof setInterval> | undefined;
  private abort: AbortController | undefined;
  private job: Promise<void> | undefined;
  private generation = 0;
  private url: string | undefined;
  private next = 0;
  constructor(
    private readonly output: (gain: number, status: NormalizationStatus) => void,
    private readonly sample = sampleAttenuation,
  ) {}
  start(stream: StreamCandidate) {
    this.stop();
    if (stream.url !== this.url) this.next = 0;
    this.url = stream.url;
    const generation = this.generation,
      abort = new AbortController();
    this.abort = abort;
    if (stream.analysis === 'denied' || stream.hls || typeof OfflineAudioContext !== 'function') {
      this.output(1, 'unavailable');
      return;
    }
    this.output(1, 'waiting');
    if (generation !== this.generation || abort.signal.aborted) return;
    let failures = 0;
    const tick = () => {
      if (this.job || Date.now() < this.next || abort.signal.aborted) return;
      this.next = Date.now() + 30000;
      this.job = Promise.resolve()
        .then(() => {
          abort.signal.throwIfAborted();
          return this.sample(stream.url, abort.signal);
        })
        .then((gain) => {
          if (generation !== this.generation || abort.signal.aborted) return;
          if (gain === null) {
            this.output(1, 'waiting');
            if (++failures >= 2) this.stop('unavailable');
          } else {
            failures = 0;
            this.output(gain, 'active');
          }
        })
        .catch(() => {
          if (generation === this.generation && !abort.signal.aborted) this.stop('unavailable');
        })
        .finally(() => {
          this.job = undefined;
          if (this.url === stream.url) this.next = Date.now() + 30000;
        });
    };
    this.timer = setInterval(tick, 500);
    tick();
  }
  stop(status: NormalizationStatus = 'off') {
    this.generation++;
    this.abort?.abort();
    this.abort = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.output(1, status);
  }
}
