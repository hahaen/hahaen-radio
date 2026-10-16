import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  ApiErrorSchema,
  CatalogChunkSchema,
  CatalogManifestSchema,
  SceneManifestSchema,
  SceneChunkSchema,
  ReadinessSchema,
  StationDetailSchema,
  StationIdSchema,
  StationLookupResultSchema,
  StationLookupSchema,
  StationPageSchema,
  StationSearchSchema,
  StreamListSchema,
} from '@haen/contracts';
import { CatalogUnavailableError, type CatalogService } from './service.js';

export function registerCatalogRoutes(app: FastifyInstance, service?: CatalogService) {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const available = () => {
    if (!service) throw new CatalogUnavailableError();
    return service;
  };
  const errors = {
    400: ApiErrorSchema,
    404: ApiErrorSchema,
    500: ApiErrorSchema,
    503: ApiErrorSchema,
  };
  const stationParams = z.object({ id: StationIdSchema });
  routes.addHook('onSend', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
  });
  routes.get(
    '/api/v1/health/ready',
    { schema: { tags: ['health'], response: { 200: ReadinessSchema, 503: ReadinessSchema } } },
    async (_request, reply) => {
      const state = service
        ? await service.readiness()
        : { status: 'not_ready' as const, database: false, catalog: false, version: null };
      return reply.code(state.status === 'ready' ? 200 : 503).send(state);
    },
  );
  routes.get(
    '/api/v1/catalog',
    { schema: { tags: ['catalog'], response: { 200: CatalogManifestSchema, ...errors } } },
    () => available().manifest(),
  );
  routes.get(
    '/api/v1/catalog/scene',
    {
      schema: { tags: ['catalog'], response: { 200: SceneManifestSchema, ...errors } },
    },
    () => available().sceneManifest(),
  );
  routes.get(
    '/api/v1/catalog/scene/:version/chunks/:index',
    {
      schema: {
        tags: ['catalog'],
        params: z.object({ version: z.uuid(), index: z.coerce.number().int().min(0).max(199) }),
        response: { 200: SceneChunkSchema, ...errors },
      },
    },
    (request) => available().sceneChunk(request.params.version, request.params.index),
  );
  routes.get(
    '/api/v1/catalog/:version/chunks/:index',
    {
      schema: {
        tags: ['catalog'],
        params: z.object({ version: z.uuid(), index: z.coerce.number().int().min(0).max(199) }),
        response: { 200: CatalogChunkSchema, ...errors },
      },
    },
    (request) => available().chunk(request.params.version, request.params.index),
  );
  routes.get(
    '/api/v1/stations',
    {
      schema: {
        tags: ['stations'],
        querystring: StationSearchSchema,
        response: { 200: StationPageSchema, ...errors },
      },
    },
    (request) => available().search(request.query),
  );
  routes.post(
    '/api/v1/stations/lookup',
    {
      schema: {
        tags: ['stations'],
        body: StationLookupSchema,
        response: { 200: StationLookupResultSchema, ...errors },
      },
    },
    (request) => available().lookup(request.body.ids),
  );
  routes.get(
    '/api/v1/stations/:id',
    {
      schema: {
        tags: ['stations'],
        params: stationParams,
        response: { 200: StationDetailSchema, ...errors },
      },
    },
    (request) => available().station(request.params.id),
  );
  routes.get(
    '/api/v1/stations/:id/streams',
    {
      schema: {
        tags: ['stations'],
        params: stationParams,
        response: { 200: StreamListSchema, ...errors },
      },
    },
    (request) => available().streams(request.params.id),
  );
  routes.get(
    '/api/v1/stations/:id/same-city',
    {
      schema: {
        tags: ['stations'],
        params: stationParams,
        response: { 200: StationPageSchema, ...errors },
      },
    },
    (request) => available().sameCity(request.params.id),
  );
}
