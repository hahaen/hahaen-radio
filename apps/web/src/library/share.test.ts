import { afterEach, expect, it, vi } from 'vitest';
import { sharedStation, shareStation, stationLink } from './share';
import { testStation } from '../testing/stations';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('validates station links and excludes unrelated parameters and fragments from shared URLs', () => {
  const id = testStation(1).id;
  expect(stationLink(id, 'https://haen.example/?private=discard#main')).toBe(
    'https://haen.example/?station=' + id,
  );
  expect(sharedStation('?station=' + id)).toEqual({ id, invalid: false });
  expect(sharedStation('?station=' + id + '&station=' + id).invalid).toBe(true);
  expect(sharedStation('?station=javascript:alert(1)').invalid).toBe(true);
});
it('preserves system share cancellation and falls back to manual copy when clipboard access fails', async () => {
  const clipboard = vi.fn().mockRejectedValue(new Error('denied'));
  vi.stubGlobal('navigator', {
    share: vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')),
    clipboard: { writeText: clipboard },
  });
  expect(await shareStation(testStation(1).id, 'Station')).toBe('cancelled');
  expect(clipboard).not.toHaveBeenCalled();
  vi.stubGlobal('navigator', { clipboard: { writeText: clipboard } });
  expect(await shareStation(testStation(1).id, 'Station')).toBe(
    stationLink(testStation(1).id, location.href),
  );
});
