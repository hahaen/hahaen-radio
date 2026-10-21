import { beforeEach, expect, it, vi } from 'vitest';
import data from '../../public/geography/regions.json';

beforeEach(() => vi.resetModules());
const payload = { CN: data.CN.slice(0, 1) };
const response = () => new Response(JSON.stringify(payload));

it('shares an in-flight request, cancels one caller promptly and lets the remaining caller finish', async () => {
  const regions = await import('./regions');
  let complete!: (value: Response) => void;
  const request = vi.fn<typeof fetch>(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const first = new AbortController(),
    second = new AbortController();
  const listener = vi.fn();
  const unsubscribe = regions.subscribeRegions(listener);
  const cancelled = regions.loadRegions(first.signal, request);
  const healthy = regions.loadRegions(second.signal, request);
  const rejection = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
  first.abort();
  await rejection;
  expect(regions.regionsVersion()).toBe(false);
  complete(response());
  await healthy;
  await regions.loadRegions(new AbortController().signal, request);
  expect(request).toHaveBeenCalledTimes(1);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(regions.regionsVersion()).toBe(true);
  unsubscribe();
});

it('does not fetch for an already cancelled caller', async () => {
  const { loadRegions } = await import('./regions');
  const controller = new AbortController(),
    request = vi.fn<typeof fetch>();
  controller.abort();
  await expect(loadRegions(controller.signal, request)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(request).not.toHaveBeenCalled();
});

it.each([
  ['http', () => new Response('', { status: 503 })],
  ['malformed', () => new Response('{')],
  [
    'invalid coordinates',
    () => new Response(JSON.stringify({ CN: [['id', ['Name'], [181, 0, 0, 0, 0, 0], [0, 1]]] })),
  ],
  ['oversized', () => new Response(new Uint8Array(4 * 1024 * 1024 + 1))],
])('rejects %s data and permits a fresh retry', async (_name, failure) => {
  const regions = await import('./regions');
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(failure())
    .mockResolvedValueOnce(response());
  await expect(regions.loadRegions(new AbortController().signal, request)).rejects.toBeDefined();
  expect(regions.regionsVersion()).toBe(false);
  await regions.loadRegions(new AbortController().signal, request);
  expect(request).toHaveBeenCalledTimes(2);
  expect(regions.regionsVersion()).toBe(true);
});
