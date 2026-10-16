import { NowPlayingSchema, LyricsResultSchema, type SongIdentity } from '@haen/contracts';
import { getJson } from './http';
export async function getNowPlaying(stationId: string, streamId: string, signal?: AbortSignal) {
  const value = await getJson(
    `/stations/${encodeURIComponent(stationId)}/now-playing?` + new URLSearchParams({ streamId }),
    NowPlayingSchema,
    signal,
  );
  if (value.stationId !== stationId || value.streamId !== streamId)
    throw new Error('TRACK_IDENTITY_MISMATCH');
  return value;
}
export const getLyrics = (song: SongIdentity, signal?: AbortSignal) =>
  getJson('/lyrics?' + new URLSearchParams(song), LyricsResultSchema, signal);
