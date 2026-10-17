import cron from 'node-cron';
import { readDatabaseConfig } from '../config/database.js';
import { openDatabase, type Database } from '../db/connection.js';
import { RadioBrowserClient } from '../integrations/radio-browser.js';
import { createCatalogRepository } from '../modules/catalog/repository.js';
import { synchronizeCatalog } from '../modules/catalog/sync.js';
import { createDiagnosticRepository } from '../modules/diagnostics/repository.js';
import { createRuntimeLog } from '../operations/runtime-log.js';

let database: Database | undefined;
let log: ReturnType<typeof createRuntimeLog> | undefined;
try {
  log = createRuntimeLog('jobs');
  database = await openDatabase(readDatabaseConfig());
  const repository = createCatalogRepository(database);
  const controller = new AbortController();
  const diagnostics = createDiagnosticRepository(database);
  let activeCleanup: Promise<void> | undefined;
  const cleanup = () => {
    if (activeCleanup || controller.signal.aborted) return;
    activeCleanup = diagnostics
      .cleanup()
      .then((removed) => {
        log!.event('diagnostic_cleanup_finished', { removed });
      })
      .catch(() => {
        log!.event('diagnostic_cleanup_failed', { level: 50 });
      })
      .finally(() => {
        activeCleanup = undefined;
      });
  };
  const cleanupTask = cron.schedule('0 * * * *', cleanup, {
    timezone: 'UTC',
    noOverlap: true,
    name: 'diagnostic-cleanup',
  });
  cleanup();
  let active: Promise<void> | undefined;
  const task = cron.schedule(
    '0 2 * * *',
    () => {
      if (active || controller.signal.aborted) return;
      active = synchronizeCatalog(repository, new RadioBrowserClient(), controller.signal)
        .then((result) => {
          log!.event('catalog_sync_finished', result);
        })
        .catch(() => {
          log!.event('catalog_sync_failed', { level: 50 });
        })
        .finally(() => {
          active = undefined;
        });
    },
    { timezone: 'UTC', noOverlap: true, name: 'catalog-sync' },
  );
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => process.exit(1), 20000).unref();
    controller.abort();
    await task.destroy();
    await cleanupTask.destroy();
    await active;
    await activeCleanup;
    await database?.close();
    log?.close();
    clearTimeout(deadline);
  };
  process.once('SIGINT', () => {
    void close();
  });
  process.once('SIGTERM', () => {
    void close();
  });
  log.event('scheduler_started');
} catch {
  log?.event('scheduler_start_failed', { level: 50 });
  await database?.close().catch(() => {});
  log?.close();
  console.error(JSON.stringify({ event: 'scheduler_start_failed' }));
  process.exitCode = 1;
}
