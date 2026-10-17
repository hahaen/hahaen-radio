import { fileURLToPath } from 'node:url';
import { readDatabaseConfig } from '../config/database.js';
import { MaintenanceError, runMaintenanceClient, withMaintenanceLock } from './maintenance.js';

export async function migrateDatabase(input: NodeJS.ProcessEnv, signal?: AbortSignal) {
  const env = { ...input };
  if (env.MIGRATION_WRITES_STOPPED !== 'true') throw new MaintenanceError();
  const config = readDatabaseConfig(env);
  await withMaintenanceLock(
    config,
    (active) =>
      runMaintenanceClient(
        process.execPath,
        ['node_modules/drizzle-kit/bin.cjs', 'migrate', '--config=drizzle.config.ts'],
        fileURLToPath(new URL('../../', import.meta.url)),
        env,
        active,
      ),
    signal,
  );
}
