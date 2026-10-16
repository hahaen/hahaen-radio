import { buildApp } from '../app.js';
import { readEnvironment } from '../config/environment.js';
import { readDatabaseConfig } from '../config/database.js';
import { openDatabase, type Database } from '../db/connection.js';
import { createCatalogRepository } from '../modules/catalog/repository.js';
import { createCatalogService } from '../modules/catalog/service.js';

let database: Database | undefined;
try {
  const config = readEnvironment();
  if (config.mode === 'production' || process.env.DB_NAME || process.env.DB_HOST)
    database = await openDatabase(readDatabaseConfig());
  const app = buildApp(
    config,
    true,
    database ? createCatalogService(createCatalogRepository(database)) : undefined,
  );
  app.addHook('onClose', async () => {
    await database?.close();
  });
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => process.exit(1), 10000).unref();
    try {
      await app.close();
    } finally {
      clearTimeout(deadline);
    }
  };
  process.once('SIGINT', () => {
    void close();
  });
  process.once('SIGTERM', () => {
    void close();
  });
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  await database?.close().catch(() => {});
  // Configuration errors contain variable names only; never print supplied values.
  console.error(
    error instanceof Error && error.message.startsWith('Invalid environment variables:')
      ? error.message
      : 'API startup failed',
  );
  process.exitCode = 1;
}
