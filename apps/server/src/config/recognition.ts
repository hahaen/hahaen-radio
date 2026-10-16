import { isAbsolute } from 'node:path';
import { z } from 'zod';
const Schema = z.object({
  AUDD_API_TOKEN: z
    .string()
    .min(1)
    .max(4096)
    .refine(
      (value) =>
        !/\s/u.test(value) &&
        [...value].every(
          (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
        ),
    ),
  RECOGNITION_REQUEST_LIMIT: z.coerce.number().int().min(1).max(100000),
  RECOGNITION_BUDGET_ID: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  RECOGNITION_STATE_PATH: z.string().min(1).refine(isAbsolute),
});
export function readRecognitionConfig(input: Record<string, string | undefined> = process.env) {
  const enabled = input.RECOGNITION_ENABLED || 'false';
  if (!['true', 'false'].includes(enabled))
    throw new Error('Invalid environment variables: RECOGNITION_ENABLED');
  if (enabled === 'false') return { enabled: false as const };
  const parsed = Schema.safeParse(input);
  if (!parsed.success)
    throw new Error(
      'Invalid environment variables: ' +
        [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))].join(', '),
    );
  return {
    enabled: true as const,
    token: parsed.data.AUDD_API_TOKEN,
    limit: parsed.data.RECOGNITION_REQUEST_LIMIT,
    budgetId: parsed.data.RECOGNITION_BUDGET_ID,
    statePath: parsed.data.RECOGNITION_STATE_PATH,
  };
}
export type RecognitionConfig = Extract<
  ReturnType<typeof readRecognitionConfig>,
  { enabled: true }
>;
