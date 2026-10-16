import type { SongIdentity } from '@haen/contracts';
import { openPublicResponse, RemoteRequestError, type PublicResponse } from './public-http.js';

export function parseBroadcastTitle(raw: string, stationName = ''): SongIdentity | null {
  if (/https?:\/\//i.test(raw) || raw.toLocaleLowerCase() === stationName.toLocaleLowerCase())
    return null;
  const match = raw.match(/^(.+?)\s+[-–—]\s+(.+)$/u);
  if (!match) return null;
  const artist = match[1]!.trim(),
    title = match[2]!.trim();
  return artist && title && artist.length <= 512 && title.length <= 512 ? { artist, title } : null;
}
export function decodeIcyTitle(bytes: Uint8Array): string | null {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes);
  }
  const value = text.replace(/\0+$/u, '').match(/(?:^|;)\s*StreamTitle='([\s\S]*?)';/i)?.[1];
  if (!value) return null;
  const clean = [...value]
    .map((character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? ' ' : character,
    )
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return clean ? clean.slice(0, 1024) : null;
}
export async function readIcyTitle(
  url: string,
  signal?: AbortSignal,
  open: typeof openPublicResponse = openPublicResponse,
): Promise<string | null> {
  const response: PublicResponse = await open(url, {
    ...(signal ? { signal } : {}),
    timeoutMs: 6000,
    icyMetadata: true,
  });
  try {
    if (response.status < 200 || response.status >= 300)
      throw new RemoteRequestError('INVALID_RESPONSE');
    const interval = Number(response.headers['icy-metaint']);
    if (!Number.isInteger(interval) || interval < 1 || interval > 262144) return null;
    if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')
      return null;
    let audioRemaining = interval,
      metadataRemaining = -1,
      total = 0;
    let metadata: Buffer[] = [];
    for await (const chunk of response.body) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      total += bytes.length;
      if (total > 512 * 1024) throw new RemoteRequestError('RESPONSE_TOO_LARGE');
      let offset = 0;
      while (offset < bytes.length) {
        if (audioRemaining) {
          const consumed = Math.min(audioRemaining, bytes.length - offset);
          audioRemaining -= consumed;
          offset += consumed;
          continue;
        }
        if (metadataRemaining === -1) {
          metadataRemaining = bytes[offset++]! * 16;
          if (metadataRemaining === 0) {
            metadataRemaining = -1;
            audioRemaining = interval;
          }
          continue;
        }
        const consumed = Math.min(metadataRemaining, bytes.length - offset);
        metadata.push(bytes.subarray(offset, offset + consumed));
        metadataRemaining -= consumed;
        offset += consumed;
        if (!metadataRemaining) {
          const title = decodeIcyTitle(Buffer.concat(metadata));
          if (title) return title;
          metadata = [];
          metadataRemaining = -1;
          audioRemaining = interval;
        }
      }
    }
    return null;
  } finally {
    response.close();
  }
}
