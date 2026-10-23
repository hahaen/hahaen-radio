import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  AccountCredentialsSchema,
  AccountSessionSchema,
  AccountOwnerSchema,
  AccountLibrarySchema,
  SaveAccountLibrarySchema,
  ApiErrorSchema,
} from '@haen/contracts';
import { AccountError, type AccountService } from './service.js';
import { CatalogUnavailableError } from '../catalog/service.js';
const tokenFrom = (request: FastifyRequest) =>
  request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => /^haen_session=[a-f0-9]{64}$/.test(part))
    ?.slice('haen_session='.length);
export function registerAccountRoutes(
  app: FastifyInstance,
  service: AccountService | undefined,
  secure: boolean,
) {
  void app.register(async (scope) => {
    scope.addHook('onRequest', async (request, reply) => {
      reply.header('cache-control', 'no-store');
      if (
        request.method !== 'GET' &&
        (request.headers['x-haen-request'] !== '1' ||
          request.headers['sec-fetch-site'] === 'cross-site')
      )
        throw new AccountError(403, 'FORBIDDEN');
    });
    const routes = scope.withTypeProvider<ZodTypeProvider>();
    const required = () => {
      if (!service) throw new CatalogUnavailableError();
      return service;
    };
    const authenticated = async (request: FastifyRequest) => {
      const user = await required().session(tokenFrom(request));
      if (!user) throw new AccountError(401, 'UNAUTHORIZED');
      return user;
    };
    const errors = {
      400: ApiErrorSchema,
      401: ApiErrorSchema,
      403: ApiErrorSchema,
      409: ApiErrorSchema,
      429: ApiErrorSchema,
      503: ApiErrorSchema,
    };
    const cookie = (token: string, age: number) =>
      `haen_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
    routes.get(
      '/api/v1/account/session',
      { schema: { response: { 200: AccountSessionSchema, ...errors } } },
      async (request) => ({ user: service ? await service.session(tokenFrom(request)) : null }),
    );
    routes.post(
      '/api/v1/account/login',
      {
        bodyLimit: 2048,
        schema: {
          body: AccountCredentialsSchema,
          response: { 200: AccountSessionSchema, ...errors },
        },
      },
      async (request, reply) => {
        const result = await required().authenticate(request.body, request.ip, tokenFrom(request));
        reply.header('set-cookie', cookie(result.token, 30 * 86400));
        return { user: result.user };
      },
    );
    routes.post(
      '/api/v1/account/logout',
      { schema: { body: AccountOwnerSchema, response: { 200: AccountSessionSchema, ...errors } } },
      async (request, reply) => {
        const user = await authenticated(request);
        if (user.id !== request.body.userId) throw new AccountError(401, 'UNAUTHORIZED');
        await required().logout(tokenFrom(request));
        reply.header('set-cookie', cookie('', 0));
        return { user: null };
      },
    );
    routes.get(
      '/api/v1/account/library',
      {
        schema: {
          querystring: AccountOwnerSchema,
          response: { 200: AccountLibrarySchema, ...errors },
        },
      },
      async (request) => required().read(await authenticated(request), request.query.userId),
    );
    routes.post(
      '/api/v1/account/library',
      {
        bodyLimit: 24 * 1024 * 1024,
        onRequest: async (request) => {
          await authenticated(request);
        },
        schema: {
          body: SaveAccountLibrarySchema,
          response: { 200: AccountLibrarySchema, ...errors },
        },
      },
      async (request) =>
        required().save(await authenticated(request), request.body.userId, request.body),
    );
  });
}
