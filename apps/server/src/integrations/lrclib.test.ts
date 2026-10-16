import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { expect, it, vi } from 'vitest';
import { parseLrc, matchLyrics, searchLyrics, LyricsRateLimited } from './lrclib.js';
import type { PublicResponse, PublicRequestOptions } from './public-http.js';
const record = {
  id: 1,
  artistName: 'Harbor Artist',
  trackName: 'Night Song',
  albumName: 'First',
  duration: 180,
  instrumental: false,
  plainLyrics: 'Original test words',
  syncedLyrics: '[00:02.50]Original test words',
};
it('parses multiple timestamp forms, global offset and repeated lines without trusting invalid clocks', () => {
  expect(
    parseLrc('[offset:500]\n[00:01.50][00:03:250]Line\n[00:99]invalid\n[ar:Person]\n[00:04]'),
  ).toEqual([
    { at: 1, text: 'Line' },
    { at: 2.75, text: 'Line' },
    { at: 3.5, text: '' },
  ]);
  expect(parseLrc('[999:00]too late')).toEqual([]);
  expect(parseLrc('[00:01]Say [hello]')).toEqual([{ at: 1, text: 'Say [hello]' }]);
});
it('retains exact identity versions and instrumental results but rejects unrelated matches, duplicates and oversized fields', () => {
  const result = matchLyrics(
    [
      record,
      record,
      { ...record, id: 2, albumName: 'Second' },
      { ...record, id: 3, artistName: 'Someone Else' },
      { ...record, id: 4, plainLyrics: 'x'.repeat(65537) },
    ],
    { artist: 'harbor artist', title: 'Night Song' },
  );
  expect(result.map((item) => item.id)).toEqual([1, 2]);
  expect(result[0]?.lines).toEqual([{ at: 2.5, text: 'Original test words' }]);
  expect(
    matchLyrics([{ ...record, syncedLyrics: '[00:01]' }], {
      artist: record.artistName,
      title: record.trackName,
    })[0]?.lines,
  ).toEqual([]);
  expect(
    matchLyrics([{ ...record, instrumental: true, plainLyrics: null, syncedLyrics: null }], {
      artist: record.artistName,
      title: record.trackName,
    })[0]?.instrumental,
  ).toBe(true);
});
it('encodes the fixed-host request, identifies the client, validates the response and always closes it', async () => {
  const result: PublicResponse = {
    status: 200,
    headers: {},
    body: Readable.from([Buffer.from(JSON.stringify([record]))]) as IncomingMessage,
    close: vi.fn(),
  };
  const open = vi.fn<(url: string, options?: PublicRequestOptions) => Promise<PublicResponse>>(
    async () => result,
  );
  const value = await searchLyrics(
    { artist: record.artistName, title: record.trackName },
    undefined,
    open,
  );
  expect(value[0]?.id).toBe(1);
  const [url, options] = open.mock.calls[0]!;
  expect(new URL(url).searchParams.get('artist_name')).toBe(record.artistName);
  expect(options?.userAgent).toContain('HAEN/0.1');
  expect(options?.allowedUrl?.(new URL('https://127.0.0.1/api/search'))).toBe(false);
  expect(result.close).toHaveBeenCalledOnce();
});
it('honors header-based throttling without parsing a non-JSON error page and closes oversized responses', async () => {
  const limited: PublicResponse = {
    status: 429,
    headers: { 'retry-after': '120' },
    body: Readable.from(['not json']) as IncomingMessage,
    close: vi.fn(),
  };
  try {
    await searchLyrics({ artist: 'A', title: 'B' }, undefined, async () => limited);
    throw new Error('Expected throttling');
  } catch (error) {
    expect(error).toBeInstanceOf(LyricsRateLimited);
    expect((error as LyricsRateLimited).until).toBeGreaterThan(Date.now() + 118000);
  }
  expect(limited.close).toHaveBeenCalledOnce();
  const large = {
    ...limited,
    status: 200,
    headers: { 'content-length': '2000000' },
    close: vi.fn(),
  };
  await expect(
    searchLyrics({ artist: 'A', title: 'B' }, undefined, async () => large),
  ).rejects.toThrow('RESPONSE_TOO_LARGE');
  expect(large.close).toHaveBeenCalledOnce();
});
it('bounds normalized output when one long lyric is repeated under thousands of timestamps', () => {
  const stamps = Array.from({ length: 2000 }, () => '[00:01]').join('');
  const lines = parseLrc(stamps + '海'.repeat(2000));
  expect(lines.length).toBeGreaterThan(0);
  expect(
    lines.reduce((size, line) => size + Buffer.byteLength(line.text) + 16, 0),
  ).toBeLessThanOrEqual(65536);
});
