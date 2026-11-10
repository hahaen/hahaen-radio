import type { MiniAppSDK } from '@discourse-mini-app/sdk';
import {
  ApiErrorSchema,
  SceneChunkSchema,
  SceneManifestSchema,
  StationLookupResultSchema,
} from '@haen/contracts';
import { z } from 'zod';
import { loadSceneCatalog } from '../src/catalog/load';
import type { CatalogRecord } from '../src/catalog/cache';
import { lookupStations } from '../src/services/catalog';
import { HttpError } from '../src/services/http';

export function createCatalog(sdk: MiniAppSDK) {
  let current: CatalogRecord | undefined;
  async function request<T>(
    endpoint: string,
    schema: z.ZodType<T>,
    signal: AbortSignal,
    query?: Record<string, string>,
  ) {
    const response = await sdk.http.request(endpoint, {
      signal,
      timeoutMs: 10000,
      ...(query ? { query } : {}),
    });
    if (response.status < 200 || response.status >= 300) {
      const error = ApiErrorSchema.safeParse(response.body);
      throw new HttpError(response.status, error.success ? error.data.code : 'HTTP_ERROR');
    }
    return schema.parse(response.body);
  }
  const lookup = (ids: readonly string[], signal: AbortSignal) =>
    lookupStations(ids, signal, (batch, active) =>
      request('radio-stations', StationLookupResultSchema, active, { ids: batch.join(',') }),
    );
  return {
    loadCatalog: (signal: AbortSignal, onProgress: (loaded: number, total: number) => void) =>
      loadSceneCatalog(signal, onProgress, {
        cache: {
          async get(key) {
            return current?.key === key ? current : undefined;
          },
          async latest() {
            return current ? [current] : [];
          },
          async put(record) {
            current = record;
          },
        },
        manifest: (active) => request('radio-scene', SceneManifestSchema, active),
        chunk: (version, index, active) =>
          request('radio-chunk', SceneChunkSchema, active, { version, index: String(index) }),
      }),
    lookup,
    async station(id: string, signal: AbortSignal) {
      const result = (await lookup([id], signal)).items[0];
      if (!result) throw new HttpError(404, 'NOT_FOUND');
      return result;
    },
  };
}
