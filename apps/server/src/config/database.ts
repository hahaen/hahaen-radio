import { readFileSync } from 'node:fs';
import { z } from 'zod';
const blank = (value: unknown) => (value === '' ? undefined : value);
const DatabaseConfigSchema = z.object({
  NODE_ENV: z.preprocess(
    blank,
    z.enum(['development', 'test', 'production']).default('development'),
  ),
  DB_HOST: z.string().min(1),
  DB_PORT: z.preprocess(blank, z.coerce.number().int().min(1).max(65535).default(3306)),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_NAME: z.string().min(1),
  DB_CONNECTION_LIMIT: z.preprocess(blank, z.coerce.number().int().min(1).max(10).default(5)),
  DB_TLS: z.preprocess(blank, z.enum(['required', 'disabled']).default('required')),
  DB_TLS_CA_PATH: z.preprocess(blank, z.string().min(1).optional()),
  REMOTE_DNS_MODE: z.preprocess(blank, z.enum(['system', 'https']).default('system')),
});
export function readDatabaseConfig(input: Record<string, string | undefined> = process.env) {
  const parsed = DatabaseConfigSchema.safeParse(input);
  if (!parsed.success)
    throw new Error(
      `Invalid database variables: ${[...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))].join(', ')}`,
    );
  const value = parsed.data;
  const validName =
    value.NODE_ENV === 'test'
      ? /^ha_radio_test_[a-z0-9_]{1,40}$/.test(value.DB_NAME)
      : value.DB_NAME === (value.NODE_ENV === 'production' ? 'ha_radio' : 'ha_radio_dev');
  if (!validName) throw new Error('Invalid database target: DB_NAME');
  if (
    value.DB_TLS === 'disabled' &&
    (value.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '::1'].includes(value.DB_HOST))
  )
    throw new Error('Unverified database connections are limited to loopback development/test');
  let ca: string | undefined;
  if (value.DB_TLS_CA_PATH) {
    try {
      ca = readFileSync(value.DB_TLS_CA_PATH, 'utf8');
    } catch {
      throw new Error('Unable to read DB_TLS_CA_PATH');
    }
  }
  return {
    host: value.DB_HOST,
    port: value.DB_PORT,
    user: value.DB_USER,
    password: value.DB_PASSWORD,
    database: value.DB_NAME,
    connectionLimit: value.DB_CONNECTION_LIMIT,
    ssl:
      value.DB_TLS === 'required'
        ? { rejectUnauthorized: true, verifyIdentity: true, ...(ca ? { ca } : {}) }
        : undefined,
  };
}
export type DatabaseConfig = ReturnType<typeof readDatabaseConfig>;
