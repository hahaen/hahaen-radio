import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { expect, it, vi } from 'vitest';
import type { PublicResponse, PublicRequestOptions } from './public-http.js';
import { readRecognitionSample } from './recognition-sample.js';
import { recognizeAudd, RecognitionProviderError } from './audd.js';
function response(
  data: Uint8Array[],
  headers: PublicResponse['headers'] = {},
  status = 200,
): PublicResponse {
  const stream = Readable.from(data);
  return {
    status,
    headers,
    body: stream as IncomingMessage,
    close: vi.fn(() => {
      stream.destroy();
    }),
  };
}
it('decodes no audio locally, retains only a bounded partial capture on its deadline and rejects caller cancellation', async () => {
  vi.useFakeTimers();
  const create = () => {
    const body = new Readable({ read() {} });
    const source: PublicResponse = {
      status: 200,
      headers: { 'content-type': 'audio/mpeg' },
      body: body as IncomingMessage,
      close: vi.fn(() => {
        body.destroy();
      }),
    };
    const open = async (_url: string, options?: PublicRequestOptions) => {
      options?.signal?.addEventListener(
        'abort',
        () => {
          body.destroy(new Error('cancelled'));
        },
        { once: true },
      );
      return source;
    };
    return { body, source, open };
  };
  try {
    const first = create();
    const capture = readRecognitionSample(
      'https://radio.example/live',
      new AbortController().signal,
      first.open,
    );
    first.body.push(Buffer.alloc(20000));
    await vi.advanceTimersByTimeAsync(8000);
    expect((await capture)?.bytes.byteLength).toBe(20000);
    expect(first.source.close).toHaveBeenCalledOnce();
    const second = create(),
      abort = new AbortController();
    const abandoned = readRecognitionSample(
      'https://radio.example/live',
      abort.signal,
      second.open,
    );
    second.body.push(Buffer.alloc(20000));
    await vi.advanceTimersByTimeAsync(1);
    const rejection = expect(abandoned).rejects.toThrow('cancelled');
    abort.abort();
    await rejection;
    expect(second.source.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
it('bounds a compressed sample and rejects unsupported or metadata-interleaved streams without retaining a response', async () => {
  const source = response([Buffer.alloc(200000)], { 'content-type': 'audio/mpeg' });
  const open = vi.fn(async () => source);
  expect(
    (await readRecognitionSample('https://radio.example/live', new AbortController().signal, open))
      ?.bytes.byteLength,
  ).toBe(128 * 1024);
  expect(source.close).toHaveBeenCalledOnce();
  for (const headers of [
    { 'content-type': 'application/vnd.apple.mpegurl' },
    { 'content-type': 'audio/mpeg', 'icy-metaint': '16000' },
    { 'content-type': 'audio/aac', 'content-encoding': 'gzip' },
  ]) {
    const rejected = response([Buffer.alloc(20000)], headers);
    expect(
      await readRecognitionSample(
        'https://radio.example/live',
        new AbortController().signal,
        async () => rejected,
      ),
    ).toBeNull();
    expect(rejected.close).toHaveBeenCalledOnce();
  }
  const tiny = response([Buffer.alloc(10)], { 'content-type': 'audio/aac' });
  expect(
    await readRecognitionSample(
      'https://radio.example/live',
      new AbortController().signal,
      async () => tiny,
    ),
  ).toBeNull();
});
it('uploads only sample bytes and a body credential to the fixed provider, strips extra metadata and returns no-match separately', async () => {
  const clip = { bytes: new Uint8Array(20000), type: 'audio/mpeg' as const };
  const upstream = response([
    Buffer.from(
      JSON.stringify({
        status: 'success',
        result: {
          artist: 'Artist',
          title: 'Song',
          album: 'Extra',
          timecode: '01:23',
          song_link: 'https://example.test/',
        },
      }),
    ),
  ]);
  const calls: { url: string; options: PublicRequestOptions }[] = [];
  const value = await recognizeAudd(
    clip,
    'unit-only-token',
    new AbortController().signal,
    async (url, options) => {
      calls.push({ url, options: options! });
      return upstream;
    },
  );
  expect(value).toEqual({ artist: 'Artist', title: 'Song' });
  expect(calls[0]!.url).toBe('https://api.audd.io/');
  const options = calls[0]!.options;
  expect(options.method).toBe('POST');
  expect(options.allowedUrl!(new URL('https://different.example/'))).toBe(false);
  const form = await new Response(options.body, {
    headers: { 'content-type': options.contentType! },
  }).formData();
  expect(form.get('api_token')).toBe('unit-only-token');
  expect(form.has('url')).toBe(false);
  expect((form.get('file') as File).size).toBe(clip.bytes.byteLength);
  expect(upstream.close).toHaveBeenCalledOnce();
  expect(
    await recognizeAudd(clip, 'unit-only-token', new AbortController().signal, async () =>
      response([Buffer.from('{"status":"success","result":null}')]),
    ),
  ).toBeNull();
});
it('handles invalid credentials, throttling, malformed and oversized replies without returning provider text', async () => {
  const clip = { bytes: new Uint8Array(20000), type: 'audio/aac' as const };
  const variants = [
    response([
      Buffer.from(
        '{"status":"error","error":{"error_code":900,"error_message":"private-provider-message"}}',
      ),
    ]),
    response([], { 'retry-after': '120' }, 429),
    response([Buffer.alloc(65537)]),
    response([Buffer.from('invalid-json')]),
  ];
  for (let index = 0; index < variants.length; index++) {
    const item = variants[index]!;
    try {
      await recognizeAudd(clip, 'unit-only-token', new AbortController().signal, async () => item);
      throw new Error('Expected a failure');
    } catch (error) {
      if (index < 2) {
        expect(error).toBeInstanceOf(RecognitionProviderError);
        expect((error as RecognitionProviderError).kind).toBe(index ? 'cooldown' : 'unavailable');
      }
      expect(String(error)).not.toContain('private-provider-message');
    }
    expect(item.close).toHaveBeenCalledOnce();
  }
});
