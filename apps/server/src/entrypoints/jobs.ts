import cron from 'node-cron';
import { readDatabaseConfig } from '../config/database.js';
import { openDatabase, type Database } from '../db/connection.js';
import { RadioBrowserClient } from '../integrations/radio-browser.js';
import { createCatalogRepository } from '../modules/catalog/repository.js';
import { synchronizeCatalog } from '../modules/catalog/sync.js';
import { createDiagnosticRepository } from '../modules/diagnostics/repository.js';

let database: Database | undefined;
try {
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
        console.info(JSON.stringify({ event: 'diagnostic_cleanup_finished', removed }));
      })
      .catch(() => {
        console.error(JSON.stringify({ event: 'diagnostic_cleanup_failed' }));
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
          console.info(JSON.stringify({ event: 'catalog_sync_finished', ...result }));
        })
        .catch(() => {
          console.error(JSON.stringify({ event: 'catalog_sync_failed' }));
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
    clearTimeout(deadline);
  };
  process.once('SIGINT', () => {
    void close();
  });
  process.once('SIGTERM', () => {
    void close();
  });
  console.info(
    JSON.stringify({ event: 'scheduler_started', timezone: 'UTC', schedule: '0 2 * * *' }),
  );
} catch {
  await database?.close().catch(() => {});
  console.error(JSON.stringify({ event: 'scheduler_start_failed' }));
  process.exitCode = 1;
}
