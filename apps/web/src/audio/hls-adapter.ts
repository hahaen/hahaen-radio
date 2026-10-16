export interface HlsSession {
  destroy(): void;
  pause(): void;
  resume(): void;
}
export interface HlsAdapter {
  supported: boolean;
  attach(
    media: HTMLAudioElement,
    url: string,
    callbacks: { ready(): void; error(): void },
  ): HlsSession;
}
export async function loadHlsAdapter(): Promise<HlsAdapter> {
  const { default: Hls } = await import('hls.js');
  return {
    supported: Hls.isSupported(),
    attach(media, url, callbacks) {
      const retry = { maxNumRetry: 0, retryDelayMs: 0, maxRetryDelayMs: 0 };
      const loadPolicy = {
        default: {
          maxTimeToFirstByteMs: 6000,
          maxLoadTimeMs: 8000,
          timeoutRetry: retry,
          errorRetry: retry,
        },
      };
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 20,
        maxMaxBufferLength: 30,
        backBufferLength: 0,
        manifestLoadPolicy: loadPolicy,
        playlistLoadPolicy: loadPolicy,
        fragLoadPolicy: loadPolicy,
        keyLoadPolicy: loadPolicy,
      });
      let parsed = false;
      try {
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          parsed = true;
          callbacks.ready();
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) callbacks.error();
        });
        hls.loadSource(url);
        hls.attachMedia(media);
      } catch (error) {
        hls.destroy();
        throw error;
      }
      return {
        destroy: () => hls.destroy(),
        pause: () => hls.stopLoad(),
        resume() {
          // stopLoad aborts an unfinished manifest; startLoad alone does not request it again.
          if (!parsed) hls.loadSource(url);
          hls.startLoad(-1);
        },
      };
    },
  };
}
