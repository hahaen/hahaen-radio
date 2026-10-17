import { applicationPath } from '../platform/paths';
import { z } from 'zod';
import { ApiErrorSchema } from '@haen/contracts';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super('Request failed');
  }
}
export async function getJson<T>(
  path: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
  request?: { method: 'POST'; body: unknown; timeoutMs?: number },
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new DOMException('Request timed out', 'TimeoutError')),
    request?.timeoutMs ?? 10000,
  );
  try {
    const response = await fetch(applicationPath(`api/v1${path}`), {
      signal: controller.signal,
      ...(request ? { method: request.method, body: JSON.stringify(request.body) } : {}),
      headers: {
        accept: 'application/json',
        ...(request ? { 'content-type': 'application/json' } : {}),
      },
    });
    if (!response.ok) {
      const error = ApiErrorSchema.safeParse(await response.json().catch(() => null));
      throw new HttpError(response.status, error.success ? error.data.code : 'HTTP_ERROR');
    }
    return schema.parse(await response.json());
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}
