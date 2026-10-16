import { z } from 'zod';
import type { LyricsRecord, SongIdentity } from '@haen/contracts';
import { openPublicResponse, RemoteRequestError } from './public-http.js';
const ClientIdentity = 'HAEN/0.1 (https://github.com/hahaen/hahaen-radio)';
const RecordSchema = z.object({
  id: z.number().int().positive(),
  artistName: z.string().min(1).max(512),
  trackName: z.string().min(1).max(512),
  albumName: z.string().max(512).default(''),
  duration: z.number().min(0).max(21600),
  instrumental: z.boolean(),
  plainLyrics: z.string().max(65536).nullable(),
  syncedLyrics: z.string().max(65536).nullable(),
});
export const canonicalSongText = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
export function parseLrc(input: string): LyricsRecord['lines'] {
  const lines: LyricsRecord['lines'] = [];
  let textBytes = 0;
  const offset = Number(input.match(/\[offset:([+-]?\d+)\]/i)?.[1] ?? 0);
  const shift = Number.isFinite(offset) && Math.abs(offset) <= 600000 ? offset / 1000 : 0;
  for (const row of input.split(/\r?\n/).slice(0, 4000)) {
    const stamps = [...row.matchAll(/\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g)];
    const text = row
      .replace(/\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g, '')
      .trim()
      .slice(0, 2048);
    for (const stamp of stamps) {
      const at =
        Number(stamp[1]) * 60 + Number(stamp[2]) + Number('0.' + (stamp[3] ?? '0')) - shift;
      if (at <= 21600) {
        const size = Buffer.byteLength(text) + 16;
        if (textBytes + size > 65536) return lines.sort((a, b) => a.at - b.at);
        lines.push({ at: Math.max(0, at), text });
        textBytes += size;
      }
      if (lines.length >= 2000) return lines.sort((a, b) => a.at - b.at);
    }
  }
  return lines.sort((a, b) => a.at - b.at);
}
export function matchLyrics(input: unknown, song: SongIdentity): LyricsRecord[] {
  if (!Array.isArray(input) || input.length > 100) throw new RemoteRequestError('INVALID_RESPONSE');
  const items: LyricsRecord[] = [];
  const ids = new Set<number>();
  for (const row of input) {
    const parsed = RecordSchema.safeParse(row);
    if (!parsed.success) continue;
    const value = parsed.data;
    if (
      ids.has(value.id) ||
      canonicalSongText(value.artistName) !== canonicalSongText(song.artist) ||
      canonicalSongText(value.trackName) !== canonicalSongText(song.title)
    )
      continue;
    const parsedLines = value.syncedLyrics ? parseLrc(value.syncedLyrics) : [];
    const lines = parsedLines.some((line) => line.text) ? parsedLines : [];
    if (!value.instrumental && !value.plainLyrics?.trim() && !lines.some((line) => line.text))
      continue;
    ids.add(value.id);
    items.push({
      id: value.id,
      artist: value.artistName,
      title: value.trackName,
      album: value.albumName,
      duration: value.duration,
      instrumental: value.instrumental,
      plain: value.plainLyrics,
      lines,
    });
    if (items.length === 8) break;
  }
  return items;
}
export class LyricsRateLimited extends Error {
  constructor(readonly until: number) {
    super('LYRICS_RATE_LIMITED');
  }
}
export async function searchLyrics(
  song: SongIdentity,
  signal?: AbortSignal,
  open: typeof openPublicResponse = openPublicResponse,
): Promise<LyricsRecord[]> {
  const url = new URL('https://lrclib.net/api/search');
  url.search = new URLSearchParams({ artist_name: song.artist, track_name: song.title }).toString();
  const response = await open(url.toString(), {
    ...(signal ? { signal } : {}),
    timeoutMs: 7000,
    userAgent: ClientIdentity,
    allowedUrl: (value) =>
      value.origin === 'https://lrclib.net' && value.pathname === '/api/search',
  });
  try {
    if (response.status === 429) {
      const raw = response.headers['retry-after'];
      const value = typeof raw === 'string' ? raw : '';
      const seconds = /^\d+$/.test(value) ? Number(value) : NaN;
      const until = Number.isFinite(seconds)
        ? Math.min(8640000000000000, Date.now() + seconds * 1000)
        : Date.parse(value);
      throw new LyricsRateLimited(
        Number.isFinite(until) ? Math.max(Date.now() + 1000, until) : Date.now() + 60000,
      );
    }
    if (response.status < 200 || response.status >= 300)
      throw new RemoteRequestError('INVALID_RESPONSE');
    const maxBytes = 1024 * 1024;
    if (Number(response.headers['content-length']) > maxBytes)
      throw new RemoteRequestError('RESPONSE_TOO_LARGE');
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      bytes += buffer.length;
      if (bytes > maxBytes) throw new RemoteRequestError('RESPONSE_TOO_LARGE');
      chunks.push(buffer);
    }
    let json: unknown;
    try {
      json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new RemoteRequestError('INVALID_RESPONSE');
    }
    return matchLyrics(json, song);
  } finally {
    response.close();
  }
}
