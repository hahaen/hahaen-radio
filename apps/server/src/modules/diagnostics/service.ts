import type { PlaybackReportRequest, PlaybackReportResult } from '@haen/contracts';
import type { CatalogService } from '../catalog/service.js';
import { CatalogNotFoundError } from '../catalog/service.js';
import type { DiagnosticRepository } from './repository.js';
import { DiagnosticConflictError } from './repository.js';

export function createDiagnosticService(
  catalog?: Pick<CatalogService, 'station'>,
  repository?: Pick<DiagnosticRepository, 'record'>,
  now = Date.now,
) {
  let closed = false,
    busy = false,
    windowStart = 0,
    attempts = 0;
  const receipts = new Map<string, { key: string; result: PlaybackReportResult; until: number }>();
  const cooldowns = new Map<string, number>();
  return {
    async report(
      id: string,
      input: PlaybackReportRequest,
      signal?: AbortSignal,
    ): Promise<PlaybackReportResult> {
      if (closed || !catalog || !repository) return { status: 'unavailable', retryAfter: null };
      signal?.throwIfAborted();
      const stationId = id.toLowerCase(),
        key = stationId + ':' + input.streamId + ':' + input.failure;
      const time = now();
      for (const [id, value] of receipts) if (value.until <= time) receipts.delete(id);
      for (const [id, until] of cooldowns) if (until <= time) cooldowns.delete(id);
      const existing = receipts.get(input.reportId);
      if (existing?.key === key) return existing.result;
      if (time - windowStart >= 60000) {
        windowStart = time;
        attempts = 0;
      }
      if (busy || attempts >= 20)
        return {
          status: 'limited',
          retryAfter: Math.min(86400, Math.max(1, Math.ceil((windowStart + 60000 - time) / 1000))),
        };
      attempts++;
      const until = cooldowns.get(key);
      if (until)
        return {
          status: 'limited',
          retryAfter: Math.min(86400, Math.max(1, Math.ceil((until - time) / 1000))),
        };
      busy = true;
      try {
        const station = await catalog.station(stationId);
        signal?.throwIfAborted();
        if (
          station.availability !== 'available' ||
          !station.streams.some((stream) => stream.id === input.streamId)
        )
          throw new CatalogNotFoundError();
        const result = await repository.record(stationId, input);
        if (result.status === 'accepted' && !closed) {
          if (receipts.size >= 256) receipts.delete(receipts.keys().next().value!);
          if (cooldowns.size >= 256) cooldowns.delete(cooldowns.keys().next().value!);
          receipts.set(input.reportId, {
            key,
            result,
            until: Math.min(now() + 300000, Date.parse(result.expiresAt)),
          });
          cooldowns.set(key, now() + 60000);
        }
        return result;
      } catch (error) {
        if (error instanceof CatalogNotFoundError || error instanceof DiagnosticConflictError)
          throw error;
        return { status: 'unavailable', retryAfter: null };
      } finally {
        busy = false;
      }
    },
    close() {
      closed = true;
      receipts.clear();
      cooldowns.clear();
    },
  };
}
export type DiagnosticService = ReturnType<typeof createDiagnosticService>;
