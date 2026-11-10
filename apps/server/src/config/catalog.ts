import { z } from 'zod';

export const defaultCatalogSyncTimeoutMs = 300000;
export const catalogSyncTimeoutSchema = z
  .number()
  .int()
  .min(1000)
  .max(45 * 60000);

export function readCatalogConfig(input: NodeJS.ProcessEnv = process.env) {
  const value = z.coerce
    .number()
    .pipe(catalogSyncTimeoutSchema)
    .safeParse(input.CATALOG_SYNC_TIMEOUT_MS || defaultCatalogSyncTimeoutMs);
  if (!value.success) throw Error('Invalid environment variables: CATALOG_SYNC_TIMEOUT_MS');
  return { timeoutMs: value.data };
}
