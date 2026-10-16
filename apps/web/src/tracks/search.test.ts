import { expect, it } from 'vitest';
import { songSearches } from './search';
import { activeLyric, lyricTime } from './lyrics-clock';
it('encodes all six external searches without interpreting song text as an address or markup', () => {
  const song = { artist: '海风 & <Artist>', title: 'A/B #?= + song' },
    links = songSearches(song);
  expect(links).toHaveLength(6);
  expect(links.map((item) => new URL(item.href).protocol)).toEqual(Array(6).fill('https:'));
  for (const link of links)
    expect(decodeURIComponent(link.href.replace(/\+/g, ' '))).toContain(
      song.artist + ' ' + song.title,
    );
  expect(new URL(links[4]!.href).searchParams.get('search_query')).toBe(
    song.artist + ' ' + song.title,
  );
});
it('selects only elapsed lyric lines and formats explicit manual positions', () => {
  const lines = [
    { at: 1, text: 'one' },
    { at: 3, text: 'two' },
    { at: 3, text: 'alternate' },
  ];
  expect(activeLyric(lines, 0)).toBe(-1);
  expect(activeLyric(lines, 3)).toBe(2);
  expect(activeLyric(lines, 10)).toBe(2);
  expect(lyricTime(-4)).toBe('00:00');
  expect(lyricTime(65.5)).toBe('01:05');
});
