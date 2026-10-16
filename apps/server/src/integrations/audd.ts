import { z } from 'zod';
import { SongIdentitySchema, type SongIdentity } from '@haen/contracts';
import { openPublicResponse } from './public-http.js';
import type { RecognitionSample } from './recognition-sample.js';
export class RecognitionProviderError extends Error {
  constructor(
    readonly kind: 'unavailable' | 'quota-exhausted' | 'cooldown' | 'error',
    readonly retryAfter = 60,
  ) {
    super('RECOGNITION_PROVIDER_' + kind);
  }
}
const ResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('success'), result: z.object(SongIdentitySchema.shape).nullable() }),
  z.object({ status: z.literal('error'), error: z.object({ error_code: z.number().int() }) }),
]);
export async function recognizeAudd(
  sample: RecognitionSample,
  token: string,
  signal: AbortSignal,
  open: typeof openPublicResponse = openPublicResponse,
): Promise<SongIdentity | null> {
  signal.throwIfAborted();
  if (sample.bytes.byteLength < 16384 || sample.bytes.byteLength > 128 * 1024)
    throw new RecognitionProviderError('error');
  const form = new FormData();
  form.set('api_token', token);
  form.set(
    'file',
    new Blob([Uint8Array.from(sample.bytes)], { type: sample.type }),
    sample.type === 'audio/mpeg' ? 'sample.mp3' : 'sample.aac',
  );
  const request = new Request('https://api.audd.io/', { method: 'POST', body: form });
  const body = new Uint8Array(await request.arrayBuffer());
  signal.throwIfAborted();
  const response = await open('https://api.audd.io/', {
    signal,
    timeoutMs: 10000,
    method: 'POST',
    body,
    contentType: request.headers.get('content-type')!,
    allowedUrl: (url) =>
      url.origin === 'https://api.audd.io' && url.pathname === '/' && !url.search,
  });
  try {
    if (response.status === 429) {
      const raw = String(response.headers['retry-after'] ?? '');
      const delay = /^\d+$/.test(raw)
        ? Number(raw)
        : Math.ceil((Date.parse(raw) - Date.now()) / 1000);
      throw new RecognitionProviderError(
        'cooldown',
        Number.isFinite(delay) ? Math.min(86400, Math.max(1, delay)) : 60,
      );
    }
    if (response.status === 402) throw new RecognitionProviderError('quota-exhausted');
    if (
      response.status < 200 ||
      response.status >= 300 ||
      Number(response.headers['content-length']) > 65536 ||
      (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')
    )
      throw new RecognitionProviderError('error');
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of response.body) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      size += bytes.byteLength;
      if (size > 65536) throw new RecognitionProviderError('error');
      chunks.push(bytes);
    }
    const value = ResponseSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (value.status === 'error')
      throw new RecognitionProviderError(
        [900, 901].includes(value.error.error_code) ? 'unavailable' : 'error',
      );
    return value.result;
  } finally {
    response.close();
  }
}
