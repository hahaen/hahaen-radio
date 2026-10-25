import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ACCOUNT_SESSION_MAX_AGE } from './session.js';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  AccountCredentialsSchema,
  AccountSessionSchema,
  AccountOwnerSchema,
  AccountLibrarySchema,
  SaveAccountLibrarySchema,
  ApiErrorSchema,
  type AccountLibrary,
} from '@haen/contracts';
import { AccountError, type AccountService } from './service.js';
import { CatalogUnavailableError } from '../catalog/service.js';
const tokenFrom = (request: FastifyRequest) =>
  request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => /^haen_session=[a-f0-9]{64}$/.test(part))
    ?.slice('haen_session='.length);
// Opt in so already-installed clients with strict collection schemas keep working.
const preferenceQuery = z.strictObject({ pinned: z.literal('1').optional() });
const libraryResponse = (value: AccountLibrary, includePinned: boolean) => {
  if (includePinned) return value;
  const { favorites, songs, history } = value.collection;
  return { ...value, collection: { favorites, songs, history } };
};
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
      async (request, reply) => {
        const token = tokenFrom(request);
        const user = service ? await service.session(token) : null;
        if (user) reply.header('set-cookie', cookie(token!, ACCOUNT_SESSION_MAX_AGE));
        return { user };
      },
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
        reply.header('set-cookie', cookie(result.token, ACCOUNT_SESSION_MAX_AGE));
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
          querystring: AccountOwnerSchema.extend(preferenceQuery.shape),
          response: { 200: AccountLibrarySchema, ...errors },
        },
      },
      async (request, reply) => {
        const result = await required().read(await authenticated(request), request.query.userId);
        reply.header('set-cookie', cookie(tokenFrom(request)!, ACCOUNT_SESSION_MAX_AGE));
        return libraryResponse(result, request.query.pinned === '1');
      },
    );
    routes.post(
      '/api/v1/account/library',
      {
        bodyLimit: 24 * 1024 * 1024,
        onRequest: async (request) => {
          await authenticated(request);
        },
        schema: {
          querystring: preferenceQuery,
          body: SaveAccountLibrarySchema,
          response: { 200: AccountLibrarySchema, ...errors },
        },
      },
      async (request, reply) => {
        const result = await required().save(
          await authenticated(request),
          request.body.userId,
          request.body,
        );
        reply.header('set-cookie', cookie(tokenFrom(request)!, ACCOUNT_SESSION_MAX_AGE));
        return libraryResponse(result, request.query.pinned === '1');
      },
    );
  });
}
