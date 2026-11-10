import { describe, expect, it, vi } from 'vitest';
import { RemoteRequestError, type PublicRequestOptions } from './public-http.js';
import { RadioBrowserClient, isDirectoryUrl } from './radio-browser.js';
const row = (number: number) => ({
  stationuuid: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
  name: `Radio ${number}`,
  url: 'https://radio.example/live',
  lastcheckok: 1,
});
describe('directory source', () => {
  it('allows slow page bodies and reads up to four pages at once in offset order', async () => {
    const requested: number[] = [];
    const pending = new Map<number, (rows: unknown[]) => void>();
    const first = row(2);
    const readJson = vi.fn<(url: string, options: PublicRequestOptions) => Promise<unknown[]>>(
      async (url) => {
        const offset = Number(new URL(url).searchParams.get('offset'));
        requested.push(offset);
        if (offset === 0) return [row(1), first];
        return new Promise<unknown[]>((resolve) => pending.set(offset, resolve));
      },
    );
    const loading = new RadioBrowserClient({
      mirrors: async () => ['de1.api.radio-browser.info'],
      readJson,
      pageSize: 2,
    }).load();
    await vi.waitFor(() => expect(requested).toEqual([0, 2, 4, 6, 8]), {
      interval: 5,
      timeout: 200,
    });
    expect(readJson.mock.calls[0]?.[1].timeoutMs).toBe(120000);
    pending.get(8)!([row(6)]);
    pending.get(6)!([row(5)]);
    pending.get(4)!([{ ...first, name: 'Later duplicate' }]);
    pending.get(2)!([row(3), row(4)]);
    const result = await loading;
    expect(result.sourceCount).toBe(5);
    expect(result.stations.map((station) => station.name)).toEqual([
      'Radio 1',
      'Later duplicate',
      'Radio 3',
      'Radio 4',
    ]);
  });
  it('reads bounded pages, deduplicates stable IDs and stops at the end', async () => {
    const readJson = vi
      .fn()
      .mockResolvedValueOnce([row(1), row(2)])
      .mockResolvedValueOnce([row(2)]);
    const client = new RadioBrowserClient({
      mirrors: async () => ['de1.api.radio-browser.info'],
      readJson,
      pageSize: 2,
      maxStations: 4,
    });
    const result = await client.load();
    expect(result.sourceCount).toBe(3);
    expect(result.stations).toHaveLength(2);
    expect(readJson.mock.calls[1]?.[0]).toContain('offset=2');
    expect(readJson).toHaveBeenCalledTimes(2);
  });
  it('does not merge partial data from a failed mirror with another mirror', async () => {
    const readJson = vi.fn(async (value: string) => {
      const url = new URL(value);
      const firstPage = url.searchParams.get('offset') === '0';
      if (url.hostname === 'de1.api.radio-browser.info') {
        if (firstPage) return [row(1)];
        throw new Error('upstream failed');
      }
      return firstPage ? [row(2)] : [];
    });
    const client = new RadioBrowserClient({
      mirrors: async () => ['de1.api.radio-browser.info', 'de2.api.radio-browser.info'],
      readJson,
      pageSize: 1,
    });
    expect((await client.load()).stations.map((station) => station.id)).toEqual([
      row(2).stationuuid,
    ]);
  });
  it('rejects empty, malformed and incomplete snapshots instead of publishing an empty catalogue', async () => {
    for (const result of [[], [{ unexpected: true }], {}]) {
      const client = new RadioBrowserClient({
        mirrors: async () => ['de1.api.radio-browser.info'],
        readJson: async () => result,
      });
      await expect(client.load()).rejects.toThrow('CATALOG_INVALID_SOURCE');
    }
    const client = new RadioBrowserClient({
      mirrors: async () => ['de1.api.radio-browser.info'],
      readJson: async () => [row(1)],
      pageSize: 1,
      maxStations: 1,
    });
    await expect(client.load()).rejects.toThrow('CATALOG_INVALID_SOURCE');
  });
  it('retries the same page after a transient disconnect without duplicating accepted rows', async () => {
    let attempts = 0;
    const readJson = vi.fn(async (value: string) => {
      const offset = Number(new URL(value).searchParams.get('offset'));
      if (offset === 0) return [row(1)];
      if (offset !== 1) return [];
      if (++attempts === 1) throw new RemoteRequestError('REQUEST_FAILED');
      return [row(2)];
    });
    const result = await new RadioBrowserClient({
      mirrors: async () => ['de1.api.radio-browser.info'],
      pageSize: 1,
      readJson,
    }).load();
    expect(result.sourceCount).toBe(2);
    expect(result.stations).toHaveLength(2);
    expect(attempts).toBe(2);
  });
  it('bounds network retries and never retries oversized or unsafe responses', async () => {
    for (const [code, count] of [
      ['TIMEOUT', 3],
      ['UNSAFE_URL', 1],
      ['RESPONSE_TOO_LARGE', 1],
    ] as const) {
      const readJson = vi.fn().mockRejectedValue(new RemoteRequestError(code));
      await expect(
        new RadioBrowserClient({
          mirrors: async () => ['de1.api.radio-browser.info'],
          readJson,
        }).load(),
      ).rejects.toThrow('CATALOG_SOURCE_UNAVAILABLE');
      expect(readJson).toHaveBeenCalledTimes(count);
    }
  });
  it('cancels an incomplete snapshot at the configured total deadline', async () => {
    let calls = 0;
    const client = new RadioBrowserClient({
      mirrors: async () => ['de1.api.radio-browser.info'],
      timeoutMs: 1000,
      pageSize: 1,
      maxStations: 2,
      readJson: async (_url, options) => {
        if (++calls === 1) return [row(1)];
        return new Promise<never>((_resolve, reject) => {
          options.signal!.addEventListener('abort', () => reject(Error('download deadline')), {
            once: true,
          });
        });
      },
    });
    await expect(client.load()).rejects.toThrow('download deadline');
    expect(calls).toBe(2);
  });
  it('does not allow a supplier-discovered host to become an arbitrary fetch target', async () => {
    expect(isDirectoryUrl(new URL('https://de1.api.radio-browser.info/json/stations'))).toBe(true);
    for (const value of [
      'https://radio-browser.info.example/',
      'https://private.example/',
      'http://de1.api.radio-browser.info/',
      'https://de1.api.radio-browser.info:8443/',
    ])
      expect(isDirectoryUrl(new URL(value))).toBe(false);
  });
});
