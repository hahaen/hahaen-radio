import type { DatabaseConfig } from './database.js';

// Constructed in memory only; the result contains credentials and must never be logged.
export function migrationConnectionUrl(config: DatabaseConfig): string {
  const url = new URL('mysql://localhost');
  url.hostname = config.host.includes(':')
    ? `[${config.host.replace(/^\[|\]$/g, '')}]`
    : config.host;
  url.port = String(config.port);
  url.username = config.user;
  url.password = config.password;
  url.pathname = `/${config.database}`;
  url.searchParams.set('charset', 'utf8mb4_general_ci');
  url.searchParams.set('timezone', 'Z');
  url.searchParams.set('connectTimeout', '8000');
  if (config.ssl) url.searchParams.set('ssl', JSON.stringify(config.ssl));
  return url.toString();
}
