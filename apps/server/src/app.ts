import { randomUUID } from 'node:crypto';
import { registerRecognitionRoutes } from './modules/recognition/routes.js';
import type { RecognitionService } from './modules/recognition/service.js';
import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { HealthResponseSchema, ApiErrorSchema, type ApiError } from '@haen/contracts';
import type { Environment } from './config/environment.js';
import { registerTrackRoutes } from './modules/tracks/routes.js';
import type { NowPlayingService } from './modules/tracks/now-playing.js';
import type { LyricsService } from './modules/tracks/lyrics.js';
import { registerCatalogRoutes } from './modules/catalog/routes.js';
import {
  CatalogNotFoundError,
  CatalogUnavailableError,
  type CatalogService,
} from './modules/catalog/service.js';

export function buildApp(
  config: Environment,
  logging = true,
  catalog?: CatalogService,
  tracks?: {
    nowPlaying?: NowPlayingService;
    lyrics?: LyricsService;
    recognition?: RecognitionService;
  },
) {
  const app = Fastify({
    logger: logging
      ? {
          level: config.logLevel,
          redact: {
            paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
            censor: '[REDACTED]',
          },
          serializers: {
            req: (request) => ({ method: request.method, route: request.routeOptions?.url }),
          },
        }
      : false,
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    trustProxy: false,
    bodyLimit: 65536,
    requestTimeout: 15000,
    connectionTimeout: 10000,
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });
  app.setErrorHandler((error, request, reply) => {
    const failure = error as { statusCode?: number; code?: string };
    const status =
      error instanceof CatalogUnavailableError
        ? 503
        : error instanceof CatalogNotFoundError
          ? 404
          : failure.statusCode === 413
            ? 413
            : failure.statusCode === 400
              ? 400
              : 500;
    const code: ApiError['code'] =
      status === 503
        ? 'SERVICE_UNAVAILABLE'
        : status === 404
          ? 'NOT_FOUND'
          : status === 413
            ? 'PAYLOAD_TOO_LARGE'
            : status === 400
              ? 'VALIDATION_ERROR'
              : 'INTERNAL_ERROR';
    if (status === 500)
      request.log.error({ event: 'request_failed', errorCode: failure.code }, 'Request failed');
    void reply.code(status).send({
      code,
      message:
        status === 500 || status === 503
          ? 'Service temporarily unavailable'
          : status === 404
            ? 'Resource not found'
            : 'Invalid request',
      requestId: request.id,
    });
  });
  app.setNotFoundHandler((request, reply) => {
    void reply
      .code(404)
      .send({ code: 'NOT_FOUND', message: 'Resource not found', requestId: request.id });
  });
  if (config.apiDocsEnabled) {
    void app.register(swagger, {
      openapi: { info: { title: 'HAEN API', version: '0.1.0' } },
      transform: jsonSchemaTransform,
    });
    void app.register(swaggerUi, { routePrefix: '/api/v1/docs' });
  }
  void app.register(async (routes) => {
    registerCatalogRoutes(routes, catalog);
    registerTrackRoutes(routes, catalog, tracks);
    registerRecognitionRoutes(routes, tracks?.recognition);
    routes.withTypeProvider<ZodTypeProvider>().get(
      '/api/v1/health/live',
      {
        schema: { tags: ['health'], response: { 200: HealthResponseSchema, 500: ApiErrorSchema } },
      },
      async () => ({ status: 'ok' as const, service: 'haen-api' as const }),
    );
  });
  return app;
}
