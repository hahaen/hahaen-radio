import type { CatalogSource } from '../../integrations/radio-browser.js';
import { CatalogSourceError } from '../../integrations/radio-browser.js';
import { LeaseLostError, type CatalogRepository } from './repository.js';
import { prepareSnapshot } from './snapshot.js';

const safeFailures = new Set([
  'CATALOG_INVALID_SIZE',
  'CATALOG_DUPLICATE_ID',
  'CATALOG_SUSPICIOUS_SHRINK',
  'CATALOG_REGISTRY_LIMIT',
  'CATALOG_PLACES_UNAVAILABLE',
]);
export async function synchronizeCatalog(
  repository: CatalogRepository,
  source: CatalogSource,
  signal?: AbortSignal,
) {
  const token = await repository.acquire();
  if (!token) return { status: 'busy' as const };
  const controller = new AbortController();
  const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
  let renewing = false;
  let heartbeat: Promise<void> = Promise.resolve();
  const timer = setInterval(() => {
    if (renewing) return;
    renewing = true;
    heartbeat = repository
      .renew(token)
      .catch(() => controller.abort(new LeaseLostError()))
      .finally(() => {
        renewing = false;
      });
  }, 30000);
  let failure: string | undefined;
  try {
    await repository.cleanup(token);
    const result = await source.load(combined);
    combined.throwIfAborted();
    const stations = await repository.enrich(result.stations, combined);
    combined.throwIfAborted();
    const snapshot = prepareSnapshot(stations, await repository.registry());
    combined.throwIfAborted();
    await repository.stage(token, snapshot, result.sourceCount, combined);
    combined.throwIfAborted();
    await repository.publish(token, snapshot);
    return {
      status: 'published' as const,
      version: snapshot.manifest.version,
      count: snapshot.manifest.stationCount,
      invalidCount: result.invalidCount,
    };
  } catch (error) {
    failure =
      error instanceof CatalogSourceError
        ? error.code
        : error instanceof LeaseLostError || controller.signal.aborted
          ? 'CATALOG_LEASE_LOST'
          : signal?.aborted
            ? 'CATALOG_CANCELLED'
            : error instanceof Error && safeFailures.has(error.message)
              ? error.message
              : 'CATALOG_SYNC_FAILED';
    throw new Error(failure, { cause: error });
  } finally {
    clearInterval(timer);
    await heartbeat;
    await repository.finish(token, failure);
  }
}
