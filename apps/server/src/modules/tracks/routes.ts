import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  ApiErrorSchema,
  StationIdSchema,
  StreamIdSchema,
  NowPlayingSchema,
  LyricsQuerySchema,
  LyricsResultSchema,
} from '@haen/contracts';
import type { CatalogService } from '../catalog/service.js';
import { CatalogUnavailableError } from '../catalog/service.js';
import { createNowPlayingService, type NowPlayingService } from './now-playing.js';
import { createLyricsService, type LyricsService } from './lyrics.js';
export function registerTrackRoutes(
  app: FastifyInstance,
  catalog?: CatalogService,
  services: { nowPlaying?: NowPlayingService; lyrics?: LyricsService } = {},
) {
  const current = services.nowPlaying ?? (catalog ? createNowPlayingService(catalog) : undefined),
    lyrics = services.lyrics ?? createLyricsService();
  app.addHook('onClose', async () => {
    current?.close();
    lyrics.close();
  });
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const errors = {
    400: ApiErrorSchema,
    404: ApiErrorSchema,
    500: ApiErrorSchema,
    503: ApiErrorSchema,
  };
  routes.get(
    '/api/v1/stations/:id/now-playing',
    {
      schema: {
        tags: ['tracks'],
        params: z.strictObject({ id: StationIdSchema }),
        querystring: z.strictObject({ streamId: StreamIdSchema }),
        response: { 200: NowPlayingSchema, ...errors },
      },
    },
    (request, reply) => {
      reply.header('cache-control', 'no-store');
      if (!current) throw new CatalogUnavailableError();
      return current.current(request.params.id, request.query.streamId);
    },
  );
  routes.get(
    '/api/v1/lyrics',
    {
      schema: {
        tags: ['tracks'],
        querystring: LyricsQuerySchema,
        response: { 200: LyricsResultSchema, ...errors },
      },
    },
    (request, reply) => {
      reply.header('cache-control', 'no-store');
      return lyrics.find(request.query);
    },
  );
}
