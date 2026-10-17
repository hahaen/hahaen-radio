import { readDatabaseConfig } from '../config/database.js';
import { migrationStatus } from '../operations/migration-plan.js';
import { migrateDatabase } from '../operations/migrate.js';

const controller = new AbortController();
const cancel = () => controller.abort();
process.once('SIGTERM', cancel);
process.once('SIGINT', cancel);
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === 'status') {
    const result = await migrationStatus(readDatabaseConfig(), controller.signal);
    console.info(JSON.stringify({ event: 'migration_status', ...result }));
  } else if (args.length === 0) {
    const result = await migrateDatabase(process.env, controller.signal);
    console.info(JSON.stringify({ event: 'migration_completed', ...result }));
  } else throw Error('Invalid arguments');
} catch {
  console.error(
    JSON.stringify({
      event: 'migration_failed',
      instruction:
        'Inspect target metadata, permissions and migration history; confirm stopped writers before a migration',
    }),
  );
  process.exitCode = 1;
} finally {
  process.removeListener('SIGTERM', cancel);
  process.removeListener('SIGINT', cancel);
}
