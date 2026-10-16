import { z } from 'zod';

const optionalValue = (value: unknown) => (value === '' ? undefined : value);
const EnvironmentSchema = z.object({
  NODE_ENV: z.preprocess(
    optionalValue,
    z.enum(['development', 'test', 'production']).default('development'),
  ),
  HOST: z.preprocess(optionalValue, z.string().min(1).default('127.0.0.1')),
  PORT: z.preprocess(optionalValue, z.coerce.number().int().min(1).max(65535).default(3001)),
  LOG_LEVEL: z.preprocess(
    optionalValue,
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ),
  API_DOCS_ENABLED: z.preprocess(optionalValue, z.enum(['true', 'false']).optional()),
});

export function readEnvironment(input: Record<string, string | undefined> = process.env) {
  const result = EnvironmentSchema.safeParse(input);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Invalid environment variables: ${fields.join(', ')}`);
  }
  const value = result.data;
  return {
    mode: value.NODE_ENV,
    host: value.HOST,
    port: value.PORT,
    logLevel: value.LOG_LEVEL,
    apiDocsEnabled:
      value.API_DOCS_ENABLED === undefined
        ? value.NODE_ENV !== 'production'
        : value.API_DOCS_ENABLED === 'true',
  };
}
export type Environment = ReturnType<typeof readEnvironment>;
