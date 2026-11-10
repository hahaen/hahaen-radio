import type { MiniAppSDK } from '@discourse-mini-app/sdk';
import { createMp3Framer } from './mp3';

export type Playback = 'idle' | 'connecting' | 'playing' | 'unsupported' | 'error';
const audioTimeout = 12_000;

function wait(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, 45);
    signal.addEventListener('abort', done, { once: true });
  });
}

export function createPlayer(sdk: MiniAppSDK, onState: (state: Playback) => void) {
  let active: { stop(): void } | undefined;
  function stop() {
    const previous = active;
    active = undefined;
    previous?.stop();
    onState('idle');
  }

  function play(endpoint: string) {
    stop();
    if (!sdk.permissions.has('network.request') || !sdk.permissions.has('audio.webAudio')) {
      onState('error');
      return;
    }
    if (typeof AudioDecoder !== 'function' || typeof AudioContext !== 'function') {
      onState('unsupported');
      return;
    }
    let context: AudioContext;
    try {
      context = new AudioContext();
    } catch {
      onState('unsupported');
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    let timer: ReturnType<typeof setTimeout>;
    let decoder: AudioDecoder | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let next = 0;
    function close() {
      if (signal.aborted) return;
      clearTimeout(timer);
      controller.abort();
      if (decoder && decoder.state !== 'closed') decoder.close();
      void reader?.cancel().catch(() => {});
      void context.close().catch(() => {});
    }
    const session = { stop: close };
    active = session;
    function fail(state: 'error' | 'unsupported' = 'error') {
      if (active !== session) return;
      active = undefined;
      close();
      onState(state);
    }
    const expectAudio = (bufferedMs = 0) => {
      clearTimeout(timer);
      timer = setTimeout(fail, audioTimeout + bufferedMs);
    };
    expectAudio();
    onState('connecting');

    function output(audio: AudioData) {
      try {
        if (signal.aborted) return;
        const buffer = context.createBuffer(
          audio.numberOfChannels,
          audio.numberOfFrames,
          audio.sampleRate,
        );
        for (let index = 0; index < audio.numberOfChannels; index++) {
          audio.copyTo(buffer.getChannelData(index), { planeIndex: index, format: 'f32-planar' });
        }
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.onended = () => source.disconnect();
        const now = context.currentTime;
        const first = next === 0;
        const start = next <= now ? now + 0.14 : next;
        source.start(start);
        next = start + buffer.duration;
        expectAudio(Math.ceil((next - now) * 1000));
        if (first) onState('playing');
      } catch {
        fail();
      } finally {
        audio.close();
      }
    }

    async function stream() {
      try {
        // resume() starts during the play button's user gesture.
        await context.resume();
        signal.throwIfAborted();
        const response = await sdk.http.stream(endpoint, { signal });
        reader = response.body.getReader();
        signal.throwIfAborted();
        const mime = response.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
        if (response.status !== 200 || mime !== 'audio/mpeg') throw new Error('Unsupported stream');
        const frames = createMp3Framer();
        let time = 0;
        let rate = 0;
        let channels = 0;
        for (;;) {
          const { done, value } = await reader.read();
          signal.throwIfAborted();
          if (done || value.byteLength > 1024 * 1024)
            throw new Error('Stream ended or chunk too large');
          for (const frame of frames(value)) {
            if (!decoder) {
              rate = frame.sampleRate;
              channels = frame.numberOfChannels;
              const config = { codec: 'mp3', sampleRate: rate, numberOfChannels: channels };
              const support = await AudioDecoder.isConfigSupported(config);
              signal.throwIfAborted();
              if (!support.supported) {
                fail('unsupported');
                return;
              }
              decoder = new AudioDecoder({ output, error: () => fail() });
              decoder.configure(config);
            }
            if (rate !== frame.sampleRate || channels !== frame.numberOfChannels)
              throw new Error('Stream format changed');
            while (
              (next - context.currentTime > 1.1 || decoder.decodeQueueSize > 16) &&
              !signal.aborted
            )
              await wait(signal);
            signal.throwIfAborted();
            decoder.decode(
              new EncodedAudioChunk({ type: 'key', timestamp: Math.round(time), data: frame.data }),
            );
            time += (frame.samples * 1_000_000) / rate;
          }
        }
      } catch {
        fail();
      } finally {
        close();
        if (reader) {
          void reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      }
    }
    void stream();
  }
  return { play, stop };
}
