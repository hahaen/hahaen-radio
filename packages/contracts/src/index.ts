import { z } from 'zod';

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('haen-api'),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ApiErrorSchema = z.object({
  code: z.enum([
    'VALIDATION_ERROR',
    'NOT_FOUND',
    'PAYLOAD_TOO_LARGE',
    'INTERNAL_ERROR',
    'SERVICE_UNAVAILABLE',
  ]),
  message: z.string(),
  requestId: z.string(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export * from './catalog.js';

export * from './scene.js';

export * from './tracks.js';
