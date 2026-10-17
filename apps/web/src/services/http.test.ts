import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthResponseSchema } from '@haen/contracts';
import { getJson, HttpError } from './http';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});
describe('HTTP boundary', () => {
  it('validates external data and preserves the API prefix', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: 'ok', service: 'haen-api' })));
    vi.stubGlobal('fetch', fetcher);
    expect(await getJson('/health/live', HealthResponseSchema)).toEqual({
      status: 'ok',
      service: 'haen-api',
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/health/live');
  });
  it('keeps API calls under the configured application subpath', async () => {
    vi.stubEnv('BASE_URL', '/radio/');
    vi.resetModules();
    const { getJson: nestedGetJson } = await import('./http');
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: 'ok', service: 'haen-api' })));
    vi.stubGlobal('fetch', fetcher);
    await nestedGetJson('/health/live', HealthResponseSchema);
    expect(fetcher.mock.calls[0]?.[0]).toBe('/radio/api/v1/health/live');
  });
  it('cancels an in-flight request with the caller signal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener(
              'abort',
              () => {
                reject(options.signal?.reason);
              },
              { once: true },
            );
          }),
      ),
    );
    const controller = new AbortController();
    const request = getJson('/health/live', HealthResponseSchema, controller.signal);
    controller.abort(new DOMException('Cancelled', 'AbortError'));
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('rejects malformed data and non-success responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('{}'))
        .mockResolvedValueOnce(new Response('', { status: 503 })),
    );
    await expect(getJson('/health/live', HealthResponseSchema)).rejects.toThrow();
    await expect(getJson('/health/live', HealthResponseSchema)).rejects.toBeInstanceOf(HttpError);
  });
});
