import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomStation, randomChinaStation, searchStations } from './catalog';
import { testStation } from '../testing/stations';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('catalogue selection scope', () => {
  it('chooses China by region code across all pages, excluding unavailable and unrelated matches', async () => {
    const offsets: number[] = [];
    const china = { ...testStation(101), countryCode: 'CN' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = new URL(input, 'https://haen.test');
        const offset = Number(url.searchParams.get('offset'));
        offsets.push(offset);
        expect(url.searchParams.get('q')).toBe('中国');
        expect(url.searchParams.get('limit')).toBe('100');
        expect(url.searchParams.get('playableOnly')).toBe('true');
        const items =
          offset === 0
            ? Array.from({ length: 100 }, (_, i) => ({
                ...testStation(i + 1),
                name: '中国之声 abroad',
              }))
            : [
                china,
                { ...testStation(102), countryCode: 'CN', availability: 'blocked' },
                { ...testStation(103), countryCode: 'CN', genre: 'religious' },
                { ...testStation(104), countryCode: 'CN' },
              ];
        return new Response(JSON.stringify({ items, total: 104, offset, limit: 100 }));
      }),
    );
    expect(
      await randomChinaStation(new AbortController().signal, [testStation(104).id]),
    ).toMatchObject({ id: china.id, countryCode: 'CN' });
    expect(offsets).toEqual([0, 100]);
  });
  it('does not fall back abroad when China has no eligible stations', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ items: [testStation(1)], total: 1, offset: 0, limit: 100 }),
          ),
      ),
    );
    expect(await randomChinaStation(new AbortController().signal)).toBeNull();
  });
  it('selects across the full filtered result while excluding failed stations', async () => {
    const offsets: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = new URL(input, 'https://haen.test');
        const offset = Number(url.searchParams.get('offset'));
        offsets.push(offset);
        expect(url.searchParams.get('playableOnly')).toBe('true');
        expect(url.searchParams.get('genres')?.split(',')).not.toContain('religious');
        expect(url.searchParams.get('genres')?.split(',')).toContain('jazz');
        expect(url.searchParams.get('q')).toBe('a&b');
        expect(url.searchParams.get('excludeIds')).toBe(testStation(3).id);
        const candidates = [testStation(1), testStation(2), testStation(4), testStation(5)];
        return new Response(
          JSON.stringify({ items: [candidates[offset]], total: 4, offset, limit: 1 }),
        );
      }),
    );
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.99);
    const selected = await randomStation(
      { q: 'a&b' },
      new AbortController().signal,
      testStation(3).id,
    );
    expect(selected?.id).toBe(testStation(5).id);
    expect(offsets).toEqual([0, 3]);
  });
  it('does not restart the same failed station when no alternative exists', async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ items: [], total: 0, offset: 0, limit: 1 })),
    );
    vi.stubGlobal('fetch', fetcher);
    expect(
      await randomStation({ q: '' }, new AbortController().signal, testStation(1).id),
    ).toBeNull();
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('retains explicitly empty filter dimensions instead of interpreting them as all options', async () => {
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input, 'https://haen.test');
      expect(url.searchParams.get('genres')).toBe('');
      expect(url.searchParams.get('languages')).toBe('');
      return new Response(JSON.stringify({ items: [], total: 0, offset: 0, limit: 30 }));
    });
    vi.stubGlobal('fetch', fetcher);
    expect((await searchStations({ q: '', genres: [], languages: [] })).total).toBe(0);
  });
});
