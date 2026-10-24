import { LoudnessNormalizer, type NormalizationStatus } from './normalization';
import { TuningSound } from './tuning';
import type { StreamCandidate } from '@haen/contracts';
import { loadHlsAdapter, type HlsAdapter, type HlsSession } from './hls-adapter';

export type PlaybackStatus =
  'idle' | 'connecting' | 'playing' | 'buffering' | 'paused' | 'blocked' | 'failed';
export type PlaybackFailure = 'network' | 'timeout' | 'unsupported' | 'unavailable' | 'offline';
export interface PlaybackSnapshot {
  stationId: string | null;
  status: PlaybackStatus;
  failure: PlaybackFailure | null;
  attempt: number;
  streamId: string | null;
  volume: number;
  muted: boolean;
  volumeControllable: boolean;
  normalization?: NormalizationStatus;
}
interface Resource {
  media: HTMLAudioElement;
  token: number;
  ready: boolean;
  listeners: [string, EventListener][];
  hls?: HlsSession;
}
const createMedia = () => {
  const media = document.createElement('audio');
  media.preload = 'none';
  media.hidden = true;
  media.setAttribute('playsinline', '');
  media.setAttribute('aria-hidden', 'true');
  document.body.append(media);
  return media;
};
export class AudioEngine {
  private snapshot: PlaybackSnapshot = {
    stationId: null,
    status: 'idle',
    failure: null,
    attempt: 0,
    streamId: null,
    volume: 0.7,
    muted: false,
    volumeControllable: true,
  };
  private audioOptions = { normalize: false, tuning: false };
  private gain = 1;
  private readonly sound = new TuningSound();
  private readonly normalizer = new LoudnessNormalizer((gain, status) => {
    this.gain = gain;
    const media = this.resource?.media;
    if (media) {
      let applied = false;
      try {
        const volume = this.snapshot.volume * gain;
        media.volume = volume;
        applied = Math.abs(media.volume - volume) < 0.005;
      } catch {
        /* System volume remains available. */
      }
      if (!applied && gain < 1) {
        this.normalizer.stop('unavailable');
        this.update({ volumeControllable: false });
        return;
      }
    }
    if (this.snapshot.normalization !== status) this.update({ normalization: status });
  });
  private readonly subscribers = new Set<() => void>();
  private resource: Resource | undefined;
  private candidates: StreamCandidate[] = [];
  private index = 0;
  private token = 0;
  private wantsPlayback = false;
  private disposed = false;
  private online = true;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private readonly options: {
      createMedia?: () => HTMLAudioElement;
      loadHls?: () => Promise<HlsAdapter>;
      timeoutMs?: number;
    } = {},
  ) {}
  readonly getSnapshot = () => this.snapshot;
  readonly subscribe = (listener: () => void) => {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  };
  private update(patch: Partial<PlaybackSnapshot>) {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.subscribers) listener();
  }
  setAudioOptions(value: { normalize: boolean; tuning: boolean }) {
    const changed = value.normalize !== this.audioOptions.normalize;
    this.audioOptions = { ...value };
    if (!value.tuning) this.sound.pause();
    if (changed) {
      this.normalizer.stop(value.normalize ? 'waiting' : 'off');
      if (value.normalize && this.snapshot.status === 'playing') this.startNormalization();
    }
  }
  activateAudio(force = false) {
    if (force || (this.audioOptions.tuning && !this.snapshot.muted && this.snapshot.volume > 0))
      this.sound.activate();
  }
  private startNormalization() {
    const candidate = this.candidates[this.index];
    if (
      this.disposed ||
      !this.wantsPlayback ||
      this.snapshot.status !== 'playing' ||
      !this.audioOptions.normalize ||
      !candidate
    )
      return;
    if (!this.snapshot.volumeControllable) {
      this.normalizer.stop('unavailable');
      return;
    }
    this.normalizer.start(candidate);
  }
  select(stationId: string, streams: StreamCandidate[], autoplay = false) {
    if (this.disposed) return;
    const changed = this.snapshot.stationId !== null && this.snapshot.stationId !== stationId;
    this.release();
    this.candidates = streams.slice(0, 3);
    this.index = 0;
    this.wantsPlayback = autoplay;
    this.update({
      stationId,
      status: streams.length ? (autoplay ? 'connecting' : 'paused') : 'failed',
      failure: streams.length ? null : 'unavailable',
      attempt: 0,
      streamId: null,
    });
    if (autoplay && this.candidates.length) {
      this.activateAudio();
      this.begin();
      if (changed && this.audioOptions.tuning && this.resource)
        this.sound.play(this.snapshot.volume, this.snapshot.muted);
    }
  }
  play() {
    if (this.disposed || !this.snapshot.stationId) return;
    this.wantsPlayback = true;
    this.activateAudio();
    if (!this.online) {
      this.fail('offline');
      return;
    }
    if (!this.candidates.length) {
      this.fail('unavailable');
      return;
    }
    const resource = this.resource;
    if (!resource) {
      this.index = 0;
      this.begin();
      return;
    }
    if (this.snapshot.status === 'playing' && !resource.media.paused) return;
    this.update({ status: 'connecting', failure: null });
    this.startTimer(resource);
    resource.hls?.resume();
    if (resource.ready) this.requestPlay(resource);
  }
  pause() {
    if (this.disposed) return;
    this.wantsPlayback = false;
    this.normalizer.stop(this.audioOptions.normalize ? 'waiting' : 'off');
    this.sound.pause();
    this.clearTimer();
    this.resource?.hls?.pause();
    this.resource?.media.pause();
    if (this.snapshot.stationId) this.update({ status: 'paused', failure: null });
  }
  retry() {
    if (this.disposed || !this.snapshot.stationId) return;
    this.wantsPlayback = true;
    this.index = 0;
    this.begin();
  }
  setOnline(online: boolean) {
    this.online = online;
    if (!online && this.wantsPlayback && this.snapshot.stationId) this.fail('offline');
  }
  setVolume(value: number) {
    if (!Number.isFinite(value)) return;
    const volume = Math.max(0, Math.min(1, value));
    const resumeSound = volume > 0 && this.snapshot.volume === 0;
    this.sound.stop();
    if (volume === 0) this.sound.pause();
    const media = this.resource?.media;
    let controllable = true;
    if (media) {
      try {
        media.volume = volume * this.gain;
        controllable = Math.abs(media.volume - volume * this.gain) < 0.005;
      } catch {
        controllable = false;
      }
    }
    this.update({ volume, volumeControllable: controllable });
    if (resumeSound && this.wantsPlayback) this.activateAudio();
  }
  setMuted(muted: boolean) {
    const resumeSound = !muted && this.snapshot.muted;
    if (muted) this.sound.pause();
    if (this.resource) this.resource.media.muted = muted;
    this.update({ muted });
    if (resumeSound && this.wantsPlayback) this.activateAudio();
  }
  private current(resource: Resource) {
    return !this.disposed && this.resource === resource && resource.token === this.token;
  }
  private begin() {
    this.release();
    if (!this.online) {
      this.fail('offline');
      return;
    }
    const candidate = this.candidates[this.index];
    if (!candidate) {
      this.fail('unavailable');
      return;
    }
    let media: HTMLAudioElement;
    try {
      media = (this.options.createMedia ?? createMedia)();
    } catch {
      this.fail('unsupported');
      return;
    }
    const resource: Resource = { media, token: this.token, ready: false, listeners: [] };
    this.resource = resource;
    this.update({
      status: this.wantsPlayback ? 'connecting' : 'paused',
      failure: null,
      attempt: this.index + 1,
      streamId: candidate.id,
    });
    this.setVolume(this.snapshot.volume);
    media.muted = this.snapshot.muted;
    const on = (name: string, action: () => void) => {
      const listener = () => {
        if (this.current(resource)) action();
      };
      resource.listeners.push([name, listener]);
      media.addEventListener(name, listener);
    };
    on('playing', () => {
      if (!this.wantsPlayback) {
        media.pause();
        return;
      }
      this.markPlaying();
    });
    for (const event of ['waiting', 'stalled'])
      on(event, () => {
        // A stalled download can coexist with uninterrupted buffered playback.
        if (event === 'stalled' && this.snapshot.status === 'playing' && this.canOutput(media))
          return;
        if (this.wantsPlayback) {
          this.normalizer.stop(this.audioOptions.normalize ? 'waiting' : 'off');
          this.update({ status: 'buffering' });
          this.startTimer(resource);
        }
      });
    on('pause', () => {
      // Commanded pauses already publish state; queued events must not cancel a later play.
      if (!this.wantsPlayback || !media.paused) return;
      this.wantsPlayback = false;
      this.normalizer.stop(this.audioOptions.normalize ? 'waiting' : 'off');
      this.sound.pause();
      this.clearTimer();
      resource.hls?.pause();
      this.update({ status: 'paused' });
    });
    on('error', () => {
      if (this.wantsPlayback)
        this.next(resource, media.error?.code === 4 ? 'unsupported' : 'network');
    });
    on('ended', () => {
      if (this.wantsPlayback) this.next(resource, 'network');
    });
    if (this.wantsPlayback) this.startTimer(resource);
    if (!candidate.hls || media.canPlayType('application/vnd.apple.mpegurl')) {
      resource.ready = true;
      media.src = candidate.url;
      if (this.wantsPlayback) this.requestPlay(resource);
      return;
    }
    void (this.options.loadHls ?? loadHlsAdapter)()
      .then((adapter) => {
        if (!this.current(resource)) return;
        if (!adapter.supported) {
          this.next(resource, 'unsupported');
          return;
        }
        const session = adapter.attach(media, candidate.url, {
          ready: () => {
            if (this.current(resource)) {
              resource.ready = true;
              if (this.wantsPlayback) this.requestPlay(resource);
            }
          },
          error: () => {
            if (this.current(resource) && this.wantsPlayback) this.next(resource, 'network');
          },
        });
        if (this.current(resource)) {
          resource.hls = session;
          if (!this.wantsPlayback) session.pause();
        } else session.destroy();
      })
      .catch(() => {
        if (this.current(resource)) this.next(resource, 'unsupported');
      });
  }
  private requestPlay(resource: Resource) {
    if (!this.current(resource) || !this.wantsPlayback) return;
    const rejected = (error: unknown) => {
      if (!this.current(resource) || !this.wantsPlayback) return;
      const name = error && typeof error === 'object' && 'name' in error ? error.name : undefined;
      if (name === 'NotAllowedError') {
        this.sound.pause();
        this.clearTimer();
        resource.hls?.pause();
        this.update({ status: 'blocked', failure: null });
      } else this.next(resource, name === 'NotSupportedError' ? 'unsupported' : 'network');
    };
    try {
      void resource.media.play().catch(rejected);
    } catch (error) {
      rejected(error);
    }
  }
  private next(resource: Resource, failure: PlaybackFailure) {
    if (!this.current(resource) || !this.wantsPlayback) return;
    this.index++;
    if (this.index < this.candidates.length) this.begin();
    else this.fail(failure);
  }
  private fail(failure: PlaybackFailure) {
    this.sound.pause();
    this.release();
    this.update({ status: 'failed', failure });
  }
  private canOutput(media: HTMLAudioElement) {
    return !media.paused && !media.ended && media.readyState >= media.HAVE_FUTURE_DATA;
  }
  private markPlaying() {
    const changed = this.snapshot.status !== 'playing';
    this.clearTimer();
    this.update({ status: 'playing', failure: null });
    if (changed) this.startNormalization();
  }
  private startTimer(resource: Resource) {
    if (this.timer) return;
    const position = resource.media.currentTime;
    this.timer = setTimeout(() => {
      if (!this.current(resource) || !this.wantsPlayback) return;
      this.timer = undefined;
      // Background task queues may deliver this timeout before a queued playing event.
      if (this.canOutput(resource.media) && resource.media.currentTime > position) {
        this.markPlaying();
        return;
      }
      this.next(resource, 'timeout');
    }, this.options.timeoutMs ?? 8000);
  }
  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
  private release() {
    this.sound.stop();
    this.normalizer.stop(this.audioOptions.normalize ? 'waiting' : 'off');
    this.token++;
    this.clearTimer();
    const resource = this.resource;
    this.resource = undefined;
    if (!resource) return;
    for (const [name, listener] of resource.listeners)
      resource.media.removeEventListener(name, listener);
    resource.hls?.destroy();
    resource.media.pause();
    resource.media.removeAttribute('src');
    resource.media.load();
    resource.media.remove();
  }
  destroy() {
    this.release();
    this.sound.destroy();
    this.wantsPlayback = false;
    this.disposed = true;
    this.subscribers.clear();
  }
}
