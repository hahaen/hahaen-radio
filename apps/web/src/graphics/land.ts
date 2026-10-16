import { z } from 'zod';
const point = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const LandSchema = z.object({
  version: z.literal(1),
  points: z.array(point).max(30000),
  polygons: z.array(z.array(z.array(point).min(4).max(20000)).min(1).max(50)).max(300),
});
export type LandData = z.infer<typeof LandSchema>;
export async function loadLand(signal: AbortSignal): Promise<LandData> {
  const active = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
  const response = await fetch('/geography/land.json?v=5.1.2-1', {
    signal: active,
    cache: 'force-cache',
  });
  if (!response.ok || !response.body) throw new Error('LAND_UNAVAILABLE');
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 1024 * 1024) throw new Error('LAND_TOO_LARGE');
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  active.throwIfAborted();
  const body = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.byteLength;
  }
  return LandSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)));
}
