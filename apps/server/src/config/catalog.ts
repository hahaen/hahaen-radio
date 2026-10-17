import { z } from 'zod';
export function readCatalogConfig(input: NodeJS.ProcessEnv = process.env) {
  const value = z.coerce
    .number()
    .int()
    .min(1000)
    .max(900000)
    .safeParse(input.CATALOG_SYNC_TIMEOUT_MS || 300000);
  if (!value.success) throw Error('Invalid environment variables: CATALOG_SYNC_TIMEOUT_MS');
  return { timeoutMs: value.data };
}
