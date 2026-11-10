import { setTimeout as delay } from 'node:timers/promises';
import { lookup, resolveSrv, reverse } from 'node:dns/promises';
import { z } from 'zod';
import type { StationDetail } from '@haen/contracts';
import { catalogSyncTimeoutSchema, defaultCatalogSyncTimeoutMs } from '../config/catalog.js';
import { normalizeStation } from '../modules/catalog/normalize.js';
import { readPublicJson, RemoteRequestError, type PublicRequestOptions } from './public-http.js';

const pageConcurrency = 4;
const pageTimeoutMs = 120000;
const mirrorName = (value: string) => /^[a-z0-9-]+\.api\.radio-browser\.info$/.test(value);
export const isDirectoryUrl = (url: URL) =>
  url.protocol === 'https:' && mirrorName(url.hostname) && (!url.port || url.port === '443');
export async function discoverDirectoryMirrors(): Promise<string[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const mirrors = await Promise.race([
      (async () => {
        const srv = await resolveSrv('_api._tcp.radio-browser.info').catch(() => []);
        const names = srv.map((entry) => entry.name);
        if (!names.some(mirrorName)) {
          const addresses = await lookup('all.api.radio-browser.info', { all: true });
          const results = await Promise.all(
            addresses.slice(0, 8).map((entry) => reverse(entry.address).catch(() => [])),
          );
          names.push(...results.flat());
        }
        return [
          ...new Set(names.map((name) => name.toLowerCase().replace(/\.$/, '')).filter(mirrorName)),
        ];
      })(),
      new Promise<string[]>((resolve) => {
        timer = setTimeout(() => resolve([]), 3000);
      }),
    ]);
    return [...new Set([...mirrors, 'de1.api.radio-browser.info'])];
  } finally {
    if (timer) clearTimeout(timer);
  }
}
export class CatalogSourceError extends Error {
  constructor(
    readonly code: 'CATALOG_SOURCE_UNAVAILABLE' | 'CATALOG_INVALID_SOURCE' | 'CATALOG_SOURCE_LIMIT',
  ) {
    super(code);
  }
}
export interface CatalogSource {
  load(
    signal?: AbortSignal,
  ): Promise<{ stations: StationDetail[]; sourceCount: number; invalidCount: number }>;
}
type JsonReader = (
  url: string,
  options: PublicRequestOptions & { maxBytes?: number },
) => Promise<unknown>;
export class RadioBrowserClient implements CatalogSource {
  constructor(
    private readonly options: {
      readJson?: JsonReader;
      mirrors?: () => Promise<string[]>;
      pageSize?: number;
      maxStations?: number;
      timeoutMs?: number;
    } = {},
  ) {}
  async load(signal?: AbortSignal) {
    const pageSize = Math.min(1000, Math.max(1, this.options.pageSize ?? 1000));
    const maxStations = Math.min(150000, Math.max(pageSize, this.options.maxStations ?? 100000));
    const timeout = catalogSyncTimeoutSchema.parse(
      this.options.timeoutMs ?? defaultCatalogSyncTimeoutMs,
    );
    const totalSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
      : AbortSignal.timeout(timeout);
    const mirrors = await (this.options.mirrors ?? discoverDirectoryMirrors)();
    const pageSchema = z.array(z.unknown()).max(pageSize);
    let invalid = false;
    for (const mirror of mirrors.filter(mirrorName).slice(0, 4)) {
      try {
        const stations = new Map<string, StationDetail>();
        let sourceCount = 0,
          invalidCount = 0,
          completed = false;
        for (let offset = 0; offset < maxStations && !completed;) {
          totalSignal.throwIfAborted();
          const end = Math.min(
            maxStations,
            offset + pageSize * (offset === 0 ? 1 : pageConcurrency),
          );
          const pages: Promise<unknown>[] = [];
          for (; offset < end; offset += pageSize)
            pages.push(this.readPage(mirror, offset, pageSize, totalSignal));
          for (const page of await Promise.allSettled(pages)) {
            if (page.status === 'rejected') throw page.reason;
            totalSignal.throwIfAborted();
            const rows = pageSchema.safeParse(page.value);
            if (!rows.success) throw new CatalogSourceError('CATALOG_INVALID_SOURCE');
            sourceCount += rows.data.length;
            for (const row of rows.data) {
              const station = normalizeStation(row);
              if (station) stations.set(station.id, station);
              else invalidCount++;
            }
            // Later offsets in the batch do not belong to this snapshot.
            if (rows.data.length < pageSize) {
              completed = true;
              break;
            }
          }
        }
        if (!completed) throw new CatalogSourceError('CATALOG_SOURCE_LIMIT');
        if (!stations.size || invalidCount > sourceCount * 0.05)
          throw new CatalogSourceError('CATALOG_INVALID_SOURCE');
        return {
          stations: [...stations.values()].sort((a, b) => a.id.localeCompare(b.id)),
          sourceCount,
          invalidCount,
        };
      } catch (error) {
        if (totalSignal.aborted) throw error;
        if (error instanceof CatalogSourceError) invalid = true;
      }
    }
    throw new CatalogSourceError(invalid ? 'CATALOG_INVALID_SOURCE' : 'CATALOG_SOURCE_UNAVAILABLE');
  }

  private async readPage(mirror: string, offset: number, pageSize: number, signal: AbortSignal) {
    const url = new URL(`https://${mirror}/json/stations/search`);
    url.search = new URLSearchParams({
      hidebroken: 'false',
      order: 'name',
      reverse: 'false',
      limit: String(pageSize),
      offset: String(offset),
    }).toString();
    for (let attempt = 0; ; attempt++) {
      try {
        return await (this.options.readJson ?? readPublicJson)(url.toString(), {
          signal,
          timeoutMs: pageTimeoutMs,
          maxBytes: 4 * 1024 * 1024,
          allowedUrl: isDirectoryUrl,
        });
      } catch (error) {
        const transient =
          error instanceof RemoteRequestError &&
          (['REQUEST_FAILED', 'TIMEOUT', 'DNS_FAILURE'].includes(error.code) ||
            (error.code === 'INVALID_RESPONSE' &&
              (error.status ?? 0) >= 500 &&
              (error.status ?? 0) <= 599));
        if (signal.aborted || attempt >= 2 || !transient) throw error;
        await delay(250 * (attempt + 1), undefined, { signal });
      }
    }
  }
}
