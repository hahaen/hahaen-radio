import type { Capabilities, RecognitionResult } from '@haen/contracts';
import type { CatalogService } from '../catalog/service.js';
import { CatalogNotFoundError, CatalogUnavailableError } from '../catalog/service.js';
import { boundedCache } from '../tracks/cache.js';
import { readRecognitionSample } from '../../integrations/recognition-sample.js';
import { recognizeAudd, RecognitionProviderError } from '../../integrations/audd.js';
import type { RecognitionQuota } from './quota.js';
type EmptyResult = Exclude<RecognitionResult, { status: 'found' }>;
type Job = {
  key: string;
  abort: AbortController;
  clients: number;
  task: Promise<RecognitionResult>;
};
export function createRecognitionService(
  catalog?: Pick<CatalogService, 'station'>,
  options: {
    token?: string;
    quota?: Pick<RecognitionQuota, 'available' | 'exhausted' | 'reserve' | 'close'>;
    sample?: typeof readRecognitionSample;
    identify?: typeof recognizeAudd;
    now?: () => number;
  } = {},
) {
  const now = options.now ?? Date.now,
    sample = options.sample ?? readRecognitionSample,
    identify = options.identify ?? recognizeAudd;
  const cache = boundedCache<RecognitionResult>(128, 1024 * 1024);
  let pending: Job | undefined,
    closing: Promise<void> | undefined,
    next = 0,
    closed = false,
    providerUnavailable = false,
    providerExhausted = false;
  const capability = (): Capabilities['recognition'] => {
    if (closed) return 'unavailable';
    if (!options.token) return 'disabled';
    if (!catalog) return 'unavailable';
    if (!options.quota?.available || providerUnavailable) return 'unavailable';
    return options.quota.exhausted || providerExhausted ? 'quota-exhausted' : 'available';
  };
  const join = (job: Job, signal?: AbortSignal) =>
    new Promise<RecognitionResult>((resolve, reject) => {
      if (signal?.aborted) {
        if (!job.clients) job.abort.abort();
        reject(signal.reason);
        return;
      }
      job.clients++;
      let settled = false;
      const finish = (value?: RecognitionResult, error?: unknown) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', cancel);
        if (--job.clients === 0) job.abort.abort();
        if (value) resolve(value);
        else reject(error);
      };
      const cancel = () => finish(undefined, signal?.reason);
      signal?.addEventListener('abort', cancel, { once: true });
      void job.task.then(
        (value) => finish(value),
        (error) => finish(undefined, error),
      );
    });
  return {
    capability,
    async recognize(
      id: string,
      streamId: string,
      signal?: AbortSignal,
    ): Promise<RecognitionResult> {
      const stationId = id.toLowerCase();
      const empty = (
        status: EmptyResult['status'],
        retryAfter: number | null = null,
        reason: EmptyResult['reason'] = null,
      ): EmptyResult => ({
        stationId,
        streamId,
        source: 'audd',
        timing: 'unknown',
        status,
        reason,
        retryAfter,
        song: null,
        observedAt: null,
      });
      signal?.throwIfAborted();
      const available = capability();
      if (available === 'disabled' || available === 'unavailable')
        return empty(
          'unavailable',
          null,
          available === 'disabled' ? 'disabled' : 'provider-unavailable',
        );
      if (!catalog) throw new CatalogUnavailableError();
      const station = await catalog.station(stationId),
        stream = station.streams.find((value) => value.id === streamId);
      signal?.throwIfAborted();
      if (station.availability !== 'available' || !stream) throw new CatalogNotFoundError();
      if (stream.hls) return empty('unavailable', null, 'unsupported-stream');
      const key = station.id + ':' + stream.id + ':' + stream.url;
      const cached = cache.get(key, now());
      if (cached) return cached;
      if (pending)
        return pending.key === key && pending.clients < 8
          ? join(pending, signal)
          : empty('busy', 10);
      if (capability() === 'quota-exhausted') return empty('quota-exhausted');
      if (capability() !== 'available') return empty('unavailable', null, 'provider-unavailable');
      if (now() < next)
        return empty('cooldown', Math.min(86400, Math.max(1, Math.ceil((next - now()) / 1000))));
      const job: Job = {
        key,
        abort: new AbortController(),
        clients: 0,
        task: Promise.resolve(empty('error', 30)),
      };
      const abort = AbortSignal.any([job.abort.signal, AbortSignal.timeout(20000)]);
      next = now() + 10000;
      job.task = Promise.resolve()
        .then(async (): Promise<RecognitionResult> => {
          let result: RecognitionResult;
          try {
            abort.throwIfAborted();
            const clip = await sample(stream.url, abort);
            abort.throwIfAborted();
            if (!clip) result = empty('unavailable', 60, 'unsupported-stream');
            else if (!(await options.quota!.reserve())) result = empty('quota-exhausted');
            else {
              abort.throwIfAborted();
              const song = await identify(clip, options.token!, abort);
              abort.throwIfAborted();
              result = song
                ? {
                    ...empty('not-found', 60),
                    status: 'found',
                    song,
                    observedAt: new Date(now()).toISOString(),
                    reason: null,
                  }
                : empty('not-found', 60);
            }
          } catch (error) {
            if (error instanceof RecognitionProviderError) {
              providerUnavailable ||= error.kind === 'unavailable';
              providerExhausted ||= error.kind === 'quota-exhausted';
              if (error.kind === 'cooldown') next = Math.max(next, now() + error.retryAfter * 1000);
              result = empty(
                error.kind === 'unavailable' ? 'unavailable' : error.kind,
                error.kind === 'cooldown' ? error.retryAfter : error.kind === 'error' ? 30 : null,
                error.kind === 'unavailable' ? 'provider-unavailable' : null,
              );
            } else result = empty('error', 30);
          }
          if (!closed && !abort.aborted && result.retryAfter)
            cache.set(key, result, now() + result.retryAfter * 1000);
          return result;
        })
        .finally(() => {
          if (pending === job) pending = undefined;
        });
      pending = job;
      return join(job, signal);
    },
    close() {
      return (closing ??= (async () => {
        closed = true;
        pending?.abort.abort();
        await pending?.task;
        cache.clear();
        await options.quota?.close();
      })());
    },
  };
}
export type RecognitionService = ReturnType<typeof createRecognitionService>;
