import { lookup, resolveSrv, reverse } from 'node:dns/promises';
import { z } from 'zod';
import type { StationDetail } from '@haen/contracts';
import { normalizeStation } from '../modules/catalog/normalize.js';
import { readPublicJson, type PublicRequestOptions } from './public-http.js';

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
    const timeout = z
      .number()
      .int()
      .min(1000)
      .max(900000)
      .parse(this.options.timeoutMs ?? 300000);
    const totalSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
      : AbortSignal.timeout(timeout);
    const mirrors = await (this.options.mirrors ?? discoverDirectoryMirrors)();
    let invalid = false;
    for (const mirror of mirrors.filter(mirrorName).slice(0, 4)) {
      try {
        const stations = new Map<string, StationDetail>();
        let sourceCount = 0,
          invalidCount = 0,
          completed = false;
        for (let offset = 0; offset < maxStations; offset += pageSize) {
          totalSignal.throwIfAborted();
          const url = new URL(`https://${mirror}/json/stations/search`);
          url.search = new URLSearchParams({
            hidebroken: 'false',
            order: 'name',
            reverse: 'false',
            limit: String(pageSize),
            offset: String(offset),
          }).toString();
          const result = await (this.options.readJson ?? readPublicJson)(url.toString(), {
            signal: totalSignal,
            timeoutMs: 20000,
            maxBytes: 4 * 1024 * 1024,
            allowedUrl: isDirectoryUrl,
          });
          const rows = z.array(z.unknown()).max(pageSize).safeParse(result);
          if (!rows.success) throw new CatalogSourceError('CATALOG_INVALID_SOURCE');
          sourceCount += rows.data.length;
          for (const row of rows.data) {
            const station = normalizeStation(row);
            if (station) stations.set(station.id, station);
            else invalidCount++;
          }
          if (rows.data.length < pageSize) {
            completed = true;
            break;
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
}
