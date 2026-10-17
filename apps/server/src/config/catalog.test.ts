import { expect, it } from 'vitest';
import { readCatalogConfig } from './catalog.js';
it('bounds the directory download deadline and retains the ordinary default', () => {
  expect(readCatalogConfig({})).toEqual({ timeoutMs: 300000 });
  expect(readCatalogConfig({ CATALOG_SYNC_TIMEOUT_MS: '900000' })).toEqual({ timeoutMs: 900000 });
  for (const value of ['0', '-1', '900001', '3.5', 'invalid'])
    expect(() => readCatalogConfig({ CATALOG_SYNC_TIMEOUT_MS: value })).toThrow(
      'CATALOG_SYNC_TIMEOUT_MS',
    );
});
