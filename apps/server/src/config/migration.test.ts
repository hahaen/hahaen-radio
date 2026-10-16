import { describe, expect, it } from 'vitest';
import { readDatabaseConfig } from './database.js';
import { migrationConnectionUrl } from './migration.js';
describe('Drizzle Kit connection options', () => {
  it('preserves verified TLS, charset, timezone and encoded credentials through the driver URL', () => {
    const config = readDatabaseConfig({
      DB_HOST: 'database.example',
      DB_PORT: '3308',
      DB_USER: 'test-user',
      DB_PASSWORD: 'test-only:@/#?&',
      DB_NAME: 'ha_radio_dev',
    });
    const url = new URL(migrationConnectionUrl(config));
    expect(url.hostname).toBe('database.example');
    expect(decodeURIComponent(url.password)).toBe(config.password);
    expect(url.searchParams.get('charset')).toBe('utf8mb4_general_ci');
    expect(url.searchParams.get('timezone')).toBe('Z');
    expect(JSON.parse(url.searchParams.get('ssl')!)).toMatchObject({
      rejectUnauthorized: true,
      verifyIdentity: true,
    });
  });
});
