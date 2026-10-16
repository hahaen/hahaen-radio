import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { expect, it, vi } from 'vitest';
import { decodeIcyTitle, parseBroadcastTitle, readIcyTitle } from './icy.js';
import type { PublicResponse } from './public-http.js';
function response(body: Buffer[], headers = { 'icy-metaint': '4' }): PublicResponse {
  const stream = Readable.from(body);
  return {
    status: 200,
    headers,
    body: stream as IncomingMessage,
    close: vi.fn(() => {
      stream.destroy();
    }),
  };
}
it('extracts a title across arbitrary chunk boundaries and closes the short stream read', async () => {
  const text = Buffer.from("StreamTitle='海风 - Night Harbor';"),
    metadata = Buffer.alloc(Math.ceil(text.length / 16) * 16);
  text.copy(metadata);
  const body = Buffer.concat([
    Buffer.from('abcd'),
    Buffer.from([0]),
    Buffer.from('efgh'),
    Buffer.from([metadata.length / 16]),
    metadata,
  ]);
  const result = response([...body].map((byte) => Buffer.from([byte]))),
    open = vi.fn(async () => result);
  expect(await readIcyTitle('https://radio.example/live', undefined, open)).toBe(
    '海风 - Night Harbor',
  );
  expect(open).toHaveBeenCalledWith(
    'https://radio.example/live',
    expect.objectContaining({ icyMetadata: true, timeoutMs: 6000 }),
  );
  expect(result.close).toHaveBeenCalledOnce();
});
it('handles empty, unsupported, oversized and truncated metadata without retaining an open stream', async () => {
  const unsupported = response([], { 'icy-metaint': '999999' });
  expect(
    await readIcyTitle('https://radio.example/live', undefined, async () => unsupported),
  ).toBeNull();
  const truncated = response([Buffer.from('abcd'), Buffer.from([2]), Buffer.from('tiny')]);
  expect(
    await readIcyTitle('https://radio.example/live', undefined, async () => truncated),
  ).toBeNull();
  const oversized = response([Buffer.alloc(512 * 1024 + 1)]);
  await expect(
    readIcyTitle('https://radio.example/live', undefined, async () => oversized),
  ).rejects.toThrow('RESPONSE_TOO_LARGE');
  for (const result of [unsupported, truncated, oversized])
    expect(result.close).toHaveBeenCalledOnce();
});
it('decodes legacy text, rejects uncertain artist/title splits and never turns a station name into a song', () => {
  expect(decodeIcyTitle(Buffer.from("StreamTitle='Beyonc\xe9 - Title';\0", 'latin1'))).toBe(
    'Beyoncé - Title',
  );
  expect(parseBroadcastTitle('Artist - A - B')).toEqual({ artist: 'Artist', title: 'A - B' });
  expect(parseBroadcastTitle('Show only')).toBeNull();
  expect(parseBroadcastTitle('Station - Radio', 'station - radio')).toBeNull();
  expect(parseBroadcastTitle('Artist - https://example.com/ad')).toBeNull();
});
