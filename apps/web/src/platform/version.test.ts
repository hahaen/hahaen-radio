import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fetchVersion, observeVersion } from './version';

const current = 'a'.repeat(32);
const latest = 'b'.repeat(32);
const response = (version = current) => new Response(JSON.stringify({ version }));
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset().mockImplementation(async () => response());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('checks immediately without cache and only reports a different build', async () => {
  const changed = vi.fn();
  const stop = observeVersion(current, changed);
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringMatching(/^\/version.json\?t=\d+$/),
    expect.objectContaining({ cache: 'no-store', credentials: 'omit' }),
  );
  expect(changed).not.toHaveBeenCalled();
  fetchMock.mockImplementation(async () => response(latest));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(changed).toHaveBeenCalledWith(latest);
  stop();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['focus', 'online', 'pageshow', 'visibilitychange'])(
  'checks on %s and coalesces simultaneous resume events',
  async (event) => {
    const changed = vi.fn();
    const stop = observeVersion(current, changed);
    await vi.advanceTimersByTimeAsync(5000);
    fetchMock.mockImplementation(async () => response(latest));
    const target = event === 'visibilitychange' ? document : window;
    target.dispatchEvent(new Event(event));
    target.dispatchEvent(new Event(event));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenCalledWith(latest);
    stop();
    target.dispatchEvent(new Event(event));
    expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  },
);

it.each([
  () => Promise.reject(new TypeError('Offline')),
  async () => new Response('Maintenance', { status: 503 }),
  async () => new Response('<html>Fallback</html>'),
  async () => new Response(JSON.stringify({ version: 'invalid' })),
])('ignores unavailable or invalid manifests and recovers at the next interval', async (fail) => {
  fetchMock.mockImplementation(fail);
  const changed = vi.fn();
  const stop = observeVersion(current, changed);
  await vi.advanceTimersByTimeAsync(0);
  expect(changed).not.toHaveBeenCalled();
  fetchMock.mockImplementation(async () => response(latest));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(changed).toHaveBeenCalledWith(latest);
  stop();
});

it('pauses while hidden and resumes when visible', async () => {
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  const changed = vi.fn();
  const stop = observeVersion(current, changed);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetchMock).not.toHaveBeenCalled();
  hidden.mockReturnValue(false);
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  stop();
});

it('bounds hanging requests and aborts them on cleanup', async () => {
  fetchMock.mockImplementation(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
      }),
  );
  const pending = fetchVersion();
  const rejection = expect(pending).rejects.toThrow('Aborted');
  await vi.advanceTimersByTimeAsync(8000);
  await rejection;
  const changed = vi.fn();
  const stop = observeVersion(current, changed);
  const signal = fetchMock.mock.calls.at(-1)?.[1]?.signal;
  stop();
  await vi.advanceTimersByTimeAsync(0);
  expect(signal?.aborted).toBe(true);
  expect(changed).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
