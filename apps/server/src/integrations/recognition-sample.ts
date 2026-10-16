import { openPublicResponse, type PublicResponse } from './public-http.js';
export interface RecognitionSample {
  bytes: Uint8Array;
  type: 'audio/mpeg' | 'audio/aac';
}
export async function readRecognitionSample(
  url: string,
  signal: AbortSignal,
  open: typeof openPublicResponse = openPublicResponse,
): Promise<RecognitionSample | null> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), 8000);
  let response: PublicResponse | undefined;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    response = await open(url, {
      signal: AbortSignal.any([signal, deadline.signal]),
      timeoutMs: 8500,
      accept: 'audio/mpeg, audio/aac, audio/aacp',
    });
    if (
      response.status < 200 ||
      response.status >= 300 ||
      response.headers['icy-metaint'] ||
      (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')
    )
      return null;
    const mime = String(response.headers['content-type'] ?? '')
      .split(';')[0]!
      .trim()
      .toLowerCase();
    const type = ['audio/mpeg', 'audio/mp3'].includes(mime)
      ? 'audio/mpeg'
      : ['audio/aac', 'audio/aacp'].includes(mime)
        ? 'audio/aac'
        : null;
    if (!type) return null;
    try {
      for await (const chunk of response.body) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        const bounded = bytes.subarray(0, 128 * 1024 - size);
        chunks.push(bounded);
        size += bounded.byteLength;
        if (size >= 128 * 1024) break;
      }
    } catch (error) {
      if (!deadline.signal.aborted || signal.aborted) throw error;
    }
    signal.throwIfAborted();
    return size >= 16384 ? { bytes: Buffer.concat(chunks), type } : null;
  } finally {
    clearTimeout(timer);
    response?.close();
  }
}
