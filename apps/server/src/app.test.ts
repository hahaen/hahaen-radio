import { describe, expect, it } from 'vitest';
import { ApiErrorSchema, HealthResponseSchema } from '@haen/contracts';
import { z } from 'zod';
import { buildApp } from './app.js';
import { readEnvironment } from './config/environment.js';

const config = readEnvironment({ NODE_ENV: 'test' });
describe('API boundary', () => {
  it('serves the shared health contract and creates its own request ID', async () => {
    const app = buildApp(config, false);
    try {
      const result = await app.inject({
        url: '/api/v1/health/live',
        headers: { 'x-request-id': 'untrusted-id' },
      });
      expect(result.statusCode).toBe(200);
      expect(HealthResponseSchema.parse(result.json()).status).toBe('ok');
      expect(result.headers['x-request-id']).not.toBe('untrusted-id');
      expect(result.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/);
    } finally {
      await app.close();
    }
  });
  it('returns the shared error contract without exception details', async () => {
    const app = buildApp(config, false);
    app.get('/api/v1/failure', async () => {
      throw new Error('private-database-detail');
    });
    app.get(
      '/api/v1/check',
      { schema: { querystring: z.object({ count: z.coerce.number().int().positive() }) } },
      async () => ({ ok: true }),
    );
    try {
      for (const [url, status, code] of [
        ['/api/v1/missing', 404, 'NOT_FOUND'],
        ['/api/v1/failure', 500, 'INTERNAL_ERROR'],
        ['/api/v1/check?count=no', 400, 'VALIDATION_ERROR'],
      ] as const) {
        const result = await app.inject(url);
        expect(result.statusCode).toBe(status);
        expect(ApiErrorSchema.parse(result.json()).code).toBe(code);
        expect(result.body).not.toContain('private-database-detail');
        expect(result.json().requestId).toBe(result.headers['x-request-id']);
      }
      const specification = await app.inject('/api/v1/docs/json');
      expect(specification.statusCode).toBe(200);
      expect(specification.json().paths['/api/v1/health/live']).toBeDefined();
    } finally {
      await app.close();
    }
  });
  it('keeps API documentation disabled by default in production', async () => {
    const app = buildApp(readEnvironment({ NODE_ENV: 'production' }), false);
    try {
      expect((await app.inject('/api/v1/docs/json')).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
  it('validates environment input without revealing invalid values', () => {
    expect(readEnvironment({ PORT: '', LOG_LEVEL: '' }).port).toBe(3001);
    expect(() => readEnvironment({ PORT: 'sensitive-invalid-value' })).toThrow(
      'Invalid environment variables: PORT',
    );
    expect(() => readEnvironment({ API_DOCS_ENABLED: 'unexpected' })).toThrow(
      'Invalid environment variables: API_DOCS_ENABLED',
    );
  });
});
