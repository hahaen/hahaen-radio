import { describe, expect, it } from 'vitest';
import { readDatabaseConfig } from './database.js';
const example = {
  DB_HOST: '127.0.0.1',
  DB_USER: 'test-user',
  DB_PASSWORD: 'test-only-value',
  DB_NAME: 'ha_radio_dev',
};
describe('database target boundaries', () => {
  it('requires an explicit project target and keeps TLS verification enabled', () => {
    const value = readDatabaseConfig(example);
    expect(value.database).toBe('ha_radio_dev');
    expect(value.ssl).toMatchObject({ rejectUnauthorized: true, verifyIdentity: true });
    expect(() => readDatabaseConfig({ ...example, DB_NAME: 'ha_radio' })).toThrow(
      'Invalid database target',
    );
    expect(() => readDatabaseConfig({ ...example, NODE_ENV: 'test' })).toThrow(
      'Invalid database target',
    );
    expect(
      readDatabaseConfig({ ...example, NODE_ENV: 'test', DB_NAME: 'ha_radio_test_catalog' })
        .database,
    ).toBe('ha_radio_test_catalog');
  });
  it('does not silently disable remote TLS or expose invalid variable values', () => {
    expect(() =>
      readDatabaseConfig({ ...example, DB_HOST: 'database.example', DB_TLS: 'disabled' }),
    ).toThrow('Unverified database connections are limited to loopback development/test');
    expect(() =>
      readDatabaseConfig({
        ...example,
        NODE_ENV: 'production',
        DB_NAME: 'ha_radio',
        DB_TLS: 'disabled',
      }),
    ).toThrow('Unverified database connections are limited to loopback development/test');
    expect(() => readDatabaseConfig({ ...example, DB_PASSWORD: undefined })).toThrow(
      'Invalid database variables: DB_PASSWORD',
    );
    expect(readDatabaseConfig({ ...example, DB_TLS: 'disabled' }).ssl).toBeUndefined();
  });
});
