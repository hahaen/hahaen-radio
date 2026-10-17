import { migrateDatabase } from '../operations/migrate.js';

const controller = new AbortController();
const cancel = () => controller.abort();
process.once('SIGTERM', cancel);
process.once('SIGINT', cancel);
try {
  await migrateDatabase(process.env, controller.signal);
  console.info(JSON.stringify({ event: 'migration_completed' }));
} catch {
  console.error(
    JSON.stringify({
      event: 'migration_failed',
      instruction:
        'Confirm stopped writers and inspect target structure and migration history before retrying',
    }),
  );
  process.exitCode = 1;
} finally {
  process.removeListener('SIGTERM', cancel);
  process.removeListener('SIGINT', cancel);
}
