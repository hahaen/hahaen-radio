import { buildApp } from '../app.js';
import { readEnvironment } from '../config/environment.js';
import { readDatabaseConfig } from '../config/database.js';
import { openDatabase, type Database } from '../db/connection.js';
import { createCatalogRepository } from '../modules/catalog/repository.js';
import { createCatalogService } from '../modules/catalog/service.js';
import { readRecognitionConfig } from '../config/recognition.js';
import { openRecognitionQuota, type RecognitionQuota } from '../modules/recognition/quota.js';
import { createRecognitionService } from '../modules/recognition/service.js';
import { createDiagnosticRepository } from '../modules/diagnostics/repository.js';
import { createDiagnosticService } from '../modules/diagnostics/service.js';
import { createRuntimeLog } from '../operations/runtime-log.js';

let database: Database | undefined;
let app: ReturnType<typeof buildApp> | undefined;
let quota: RecognitionQuota | undefined;
let log: ReturnType<typeof createRuntimeLog> | undefined;
try {
  const config = readEnvironment();
  log = createRuntimeLog('api');
  const recognitionConfig = readRecognitionConfig();
  if (config.mode === 'production' || process.env.DB_NAME || process.env.DB_HOST)
    database = await openDatabase(readDatabaseConfig());
  const catalog = database ? createCatalogService(createCatalogRepository(database)) : undefined;
  if (recognitionConfig.enabled) quota = await openRecognitionQuota(recognitionConfig);
  app = buildApp(
    config,
    true,
    catalog,
    {
      diagnostics: createDiagnosticService(
        catalog,
        database ? createDiagnosticRepository(database) : undefined,
      ),
      recognition: createRecognitionService(
        catalog,
        recognitionConfig.enabled ? { token: recognitionConfig.token, quota: quota! } : {},
      ),
    },
    log,
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
      await app!.close();
    } finally {
      log?.close();
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
  log?.event('api_start_failed', { level: 50 });
  await app?.close().catch(() => {});
  await quota?.close().catch(() => {});
  await database?.close().catch(() => {});
  log?.close();
  // Configuration errors contain variable names only; never print supplied values.
  console.error(
    error instanceof Error &&
      (error.message.startsWith('Invalid environment variables:') ||
        error.message.startsWith('Recognition quota unavailable:'))
      ? error.message
      : 'API startup failed',
  );
  process.exitCode = 1;
}
