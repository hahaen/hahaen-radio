import type { LyricsRecord } from '@haen/contracts';
export function activeLyric(lines: LyricsRecord['lines'], seconds: number) {
  let low = 0,
    high = lines.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (lines[middle]!.at <= seconds) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}
export function lyricTime(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)
    .toString()
    .padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`;
}
