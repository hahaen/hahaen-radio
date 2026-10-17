import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  ApiErrorSchema,
  PlaybackReportRequestSchema,
  PlaybackReportResultSchema,
  StationIdSchema,
} from '@haen/contracts';
import { DiagnosticConflictError } from './repository.js';
import { createDiagnosticService, type DiagnosticService } from './service.js';
export function registerDiagnosticRoutes(app: FastifyInstance, provided?: DiagnosticService) {
  const service = provided ?? createDiagnosticService();
  app.addHook('onClose', async () => service.close());
  app.withTypeProvider<ZodTypeProvider>().post(
    '/api/v1/stations/:id/playback-reports',
    {
      bodyLimit: 512,
      onRequest: async (request, reply) => {
        if (
          request.headers['sec-fetch-site'] === 'cross-site' ||
          request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json'
        )
          return reply
            .code(400)
            .send({ code: 'VALIDATION_ERROR', message: 'Invalid request', requestId: request.id });
      },
      schema: {
        tags: ['diagnostics'],
        params: z.strictObject({ id: StationIdSchema }),
        querystring: z.strictObject({}),
        body: PlaybackReportRequestSchema,
        response: {
          202: PlaybackReportResultSchema,
          429: PlaybackReportResultSchema,
          503: PlaybackReportResultSchema,
          400: ApiErrorSchema,
          404: ApiErrorSchema,
          413: ApiErrorSchema,
          500: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header('cache-control', 'no-store');
      const abort = new AbortController();
      const cancel = () => {
        if (!reply.raw.writableEnded) abort.abort();
      };
      reply.raw.once('close', cancel);
      try {
        const result = await service.report(request.params.id, request.body, abort.signal);
        if (result.status === 'limited') reply.header('retry-after', String(result.retryAfter));
        return reply
          .code(result.status === 'accepted' ? 202 : result.status === 'limited' ? 429 : 503)
          .send(result);
      } catch (error) {
        if (error instanceof DiagnosticConflictError)
          return reply
            .code(400)
            .send({ code: 'VALIDATION_ERROR', message: 'Invalid request', requestId: request.id });
        throw error;
      } finally {
        reply.raw.removeListener('close', cancel);
      }
    },
  );
}
