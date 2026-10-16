import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  ApiErrorSchema,
  CapabilitiesSchema,
  RecognitionRequestSchema,
  RecognitionResultSchema,
  StationIdSchema,
} from '@haen/contracts';
import { createRecognitionService, type RecognitionService } from './service.js';
export function registerRecognitionRoutes(app: FastifyInstance, provided?: RecognitionService) {
  const service = provided ?? createRecognitionService();
  app.addHook('preClose', () => service.close());
  app.addHook('onClose', () => service.close());
  const routes = app.withTypeProvider<ZodTypeProvider>();
  routes.get(
    '/api/v1/capabilities',
    {
      schema: {
        tags: ['health'],
        querystring: z.strictObject({}),
        response: { 200: CapabilitiesSchema },
      },
    },
    (_request, reply) => {
      reply.header('cache-control', 'no-store');
      return { recognition: service.capability() };
    },
  );
  routes.post(
    '/api/v1/stations/:id/recognition',
    {
      schema: {
        tags: ['tracks'],
        params: z.strictObject({ id: StationIdSchema }),
        body: RecognitionRequestSchema,
        querystring: z.strictObject({}),
        response: {
          200: RecognitionResultSchema,
          400: ApiErrorSchema,
          404: ApiErrorSchema,
          500: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header('cache-control', 'no-store');
      if (request.headers['sec-fetch-site'] === 'cross-site')
        return reply
          .code(400)
          .send({ code: 'VALIDATION_ERROR', message: 'Invalid request', requestId: request.id });
      const abort = new AbortController();
      const timeout = () => {
        abort.abort();
        reply.raw.destroy();
      };
      reply.raw.setTimeout(25000, timeout);
      const cancel = () => {
        if (!reply.raw.writableEnded) abort.abort();
      };
      reply.raw.once('close', cancel);
      try {
        return await service.recognize(request.params.id, request.body.streamId, abort.signal);
      } finally {
        reply.raw.removeListener('close', cancel);
        reply.raw.removeListener('timeout', timeout);
      }
    },
  );
}
