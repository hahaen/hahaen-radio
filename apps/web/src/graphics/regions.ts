import { z } from 'zod';
import { applicationPath } from '../platform/paths.js';
import { coverageContains } from './country-coverage.js';
import { REGION_DATA_VERSION } from './region-version.js';

const RegionSchema = z.tuple([
  z.string().max(64),
  z.array(z.string().max(512)).min(1).max(100),
  z.tuple([
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
  ]),
  z
    .array(z.number().int().min(0).max(1036800))
    .min(2)
    .max(100000)
    .refine((values) => values.length % 2 === 0),
]);
const RegionsSchema = z.record(z.string().regex(/^[A-Z]{2}$/), z.array(RegionSchema).max(1000));
export interface DisplayRegion {
  id: string;
  name: string;
  nameEn: string;
  triangle: readonly number[];
  coverage: readonly number[];
}
const byCountry = new Map<string, Map<string, DisplayRegion | null>>();
const listeners = new Set<() => void>();
let loaded = false;
let pending: Promise<void> | undefined;
export const regionsVersion = () => loaded;
export function subscribeRegions(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const normalize = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(
      /(?:特别行政区|特別行政區|壮族自治区|壯族自治區|维吾尔自治区|維吾爾自治區|回族自治区|回族自治區|自治区|自治區|省|市|\s+(?:province|state|sheng|shi|zizhiqu))$/u,
      '',
    )
    .replace(/[^\p{L}\p{N}]/gu, '');

export async function loadRegions(signal: AbortSignal, request: typeof fetch = fetch) {
  signal.throwIfAborted();
  if (!loaded && !pending)
    pending = (async () => {
      const response = await request(
        applicationPath(`geography/regions.json?v=${REGION_DATA_VERSION}`),
        {
          signal: AbortSignal.timeout(15000),
          cache: 'force-cache',
        },
      );
      if (!response.ok || !response.body) throw new Error('REGIONS_UNAVAILABLE');
      const reader = response.body.getReader(),
        parts: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 4 * 1024 * 1024) throw new Error('REGIONS_TOO_LARGE');
          parts.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) {
        bytes.set(part, offset);
        offset += part.byteLength;
      }
      const data = RegionsSchema.parse(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      );
      for (const [code, entries] of Object.entries(data)) {
        const names = new Map<string, DisplayRegion | null>();
        for (const [id, aliases, triangle, coverage] of entries) {
          const region: DisplayRegion = {
            id,
            name: aliases.find((v) => /[\u3400-\u9fff]/u.test(v)) ?? aliases[0]!,
            nameEn: aliases[0]!,
            triangle,
            coverage,
          };
          for (const alias of aliases) {
            const key = normalize(alias);
            if (!key) continue;
            const previous = names.get(key);
            names.set(key, previous === undefined || previous?.id === id ? region : null);
          }
        }
        byCountry.set(code, names);
      }
      // Resolve explicit province-level names against their geographic component data.
      const china = byCountry.get('CN')!;
      for (const [code, aliases] of [
        ['TW', ['台湾', '臺灣', '台湾省', '臺灣省', 'Taiwan', 'CN-TW']],
        ['HK', ['香港', '香港特别行政区', '香港特別行政區', 'Hong Kong', 'CN-HK']],
        ['MO', ['澳门', '澳門', '澳门特别行政区', '澳門特別行政區', 'Macau', 'Macao', 'CN-MO']],
      ] as const) {
        const entries = data[code];
        if (!entries?.length) continue;
        const area = (t: readonly number[]) =>
          Math.abs((t[2]! - t[0]!) * (t[5]! - t[1]!) - (t[3]! - t[1]!) * (t[4]! - t[0]!));
        const largest = entries.reduce((a, b) => (area(a[2]) >= area(b[2]) ? a : b));
        const intervals = entries
          .flatMap((entry) =>
            Array.from(
              { length: entry[3].length / 2 },
              (_, i) =>
                [entry[3][i * 2]!, entry[3][i * 2]! + entry[3][i * 2 + 1]!] as [number, number],
            ),
          )
          .sort((a, b) => a[0] - b[0]);
        const merged: [number, number][] = [];
        for (const interval of intervals) {
          const last = merged.at(-1);
          if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
          else merged.push([...interval]);
        }
        const region: DisplayRegion = {
          id: `CN-${code}`,
          name: aliases[0],
          nameEn: code === 'TW' ? 'Taiwan' : code === 'HK' ? 'Hong Kong' : 'Macau',
          triangle: largest[2],
          coverage: merged.flatMap(([a, b]) => [a, b - a]),
        };
        for (const alias of aliases) china.set(normalize(alias), region);
      }
      loaded = true;
      for (const listener of listeners) listener();
    })().catch((error) => {
      pending = undefined;
      throw error;
    });
  if (pending) {
    const task = pending;
    await new Promise<void>((resolve, reject) => {
      const finish = (action: () => void) => {
        signal.removeEventListener('abort', abort);
        action();
      };
      const abort = () => finish(() => reject(signal.reason));
      signal.addEventListener('abort', abort, { once: true });
      task.then(
        () => finish(resolve),
        (error) => finish(() => reject(error)),
      );
      if (signal.aborted) abort();
    });
  }
  signal.throwIfAborted();
}

export function stationRegion(
  countryCode: string | null,
  value: string | null,
): DisplayRegion | null {
  if (!countryCode || !value) return null;
  const names = byCountry.get(countryCode);
  if (!names) return null;
  const normalized = normalize(value);
  const exact = names.get(normalized);
  if (exact) return exact;
  const matches = new Map<string, DisplayRegion>();
  for (const part of value.split(/[,，/;；·]/u)) {
    const region = names.get(normalize(part.trim()));
    if (region) matches.set(region.id, region);
  }
  if (countryCode === 'CN')
    for (const [alias, region] of names) {
      if (region && /^[\u3400-\u9fff]{2,}$/u.test(alias) && normalized.startsWith(alias))
        matches.set(region.id, region);
    }
  return matches.size === 1 ? [...matches.values()][0]! : null;
}

export const coordinatesMatchRegion = (
  region: DisplayRegion,
  latitude: number,
  longitude: number,
) => coverageContains(region.coverage, latitude, longitude);
