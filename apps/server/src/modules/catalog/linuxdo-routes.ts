import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  SceneChunkSchema,
  SceneManifestSchema,
  StationLookupResultSchema,
  StationLookupSchema,
} from '@haen/contracts';
import { z } from 'zod';
import { CatalogUnavailableError, type CatalogService } from './service.js';

export function registerLinuxDoCatalogRoutes(app: FastifyInstance, catalog?: CatalogService) {
  const available = () => {
    if (!catalog) throw new CatalogUnavailableError();
    return catalog;
  };
  void app.register(
    async (scope) => {
      const routes = scope.withTypeProvider<ZodTypeProvider>();
      routes.addHook('onRequest', async (request, reply) => {
        reply.header('Vary', 'Origin').header('Cache-Control', 'no-store');
        if (request.headers.origin === 'https://linux.do') {
          reply.header('Access-Control-Allow-Origin', 'https://linux.do');
        }
      });
      for (const path of ['/scene', '/chunk', '/stations']) {
        routes.options(path, async (request, reply) => {
          if (request.headers.origin === 'https://linux.do')
            reply.header('Access-Control-Allow-Methods', 'GET');
          return reply.code(204).send();
        });
      }
      routes.get('/scene', { schema: { response: { 200: SceneManifestSchema } } }, () =>
        available().sceneManifest(),
      );
      routes.get(
        '/chunk',
        {
          schema: {
            querystring: z.strictObject({
              version: z.uuid(),
              index: z.coerce.number().int().min(0).max(199),
            }),
            response: { 200: SceneChunkSchema },
          },
        },
        ({ query }) => available().sceneChunk(query.version, query.index),
      );
      routes.get(
        '/stations',
        {
          schema: {
            querystring: z.strictObject({
              ids: z
                .string()
                .max(3699)
                .transform((ids) => ({ ids: ids.split(',') }))
                .pipe(StationLookupSchema),
            }),
            response: { 200: StationLookupResultSchema },
          },
        },
        ({ query }) => available().lookup(query.ids.ids),
      );
    },
    { prefix: '/api/v1/linuxdo' },
  );
}
