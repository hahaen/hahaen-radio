import { z } from 'zod';
import { StationIdSchema } from '@haen/contracts';
import { readCatalogConfig } from '../config/catalog.js';
import { readDatabaseConfig } from '../config/database.js';
import { openDatabase, type Database } from '../db/connection.js';
import { RadioBrowserClient } from '../integrations/radio-browser.js';
import { createCatalogRepository } from '../modules/catalog/repository.js';
import { createCatalogService } from '../modules/catalog/service.js';
import { synchronizeCatalog } from '../modules/catalog/sync.js';

const args = process.argv.slice(2);
const controller = new AbortController();
const abort = () => controller.abort();
process.once('SIGINT', abort);
process.once('SIGTERM', abort);
let database: Database | undefined;
try {
  if (!['sync', 'status', 'block', 'unblock'].includes(args[0] ?? ''))
    throw new Error('INVALID_COMMAND');
  const command = args[0];
  const id =
    command === 'block' || command === 'unblock'
      ? StationIdSchema.parse(args[1]).toLowerCase()
      : undefined;
  const reason =
    command === 'block' ? z.string().trim().min(1).max(255).parse(args[2]) : 'operator-unblocked';
  database = await openDatabase(readDatabaseConfig());
  const repository = createCatalogRepository(database);
  if (command === 'sync')
    console.info(
      JSON.stringify(
        await synchronizeCatalog(
          repository,
          new RadioBrowserClient(readCatalogConfig()),
          controller.signal,
        ),
      ),
    );
  else if (command === 'status')
    console.info(JSON.stringify(await createCatalogService(repository).readiness()));
  else if (id) {
    await repository.setBlocked(id, command === 'block', reason);
    console.info(
      JSON.stringify({
        event: 'station_override_updated',
        stationId: id,
        blocked: command === 'block',
      }),
    );
  }
} catch {
  console.error(
    JSON.stringify({
      event: 'catalog_command_failed',
      usage: 'catalog sync | status | block <uuid> <reason> | unblock <uuid>',
    }),
  );
  process.exitCode = 1;
} finally {
  process.removeListener('SIGINT', abort);
  process.removeListener('SIGTERM', abort);
  await database?.close();
}
