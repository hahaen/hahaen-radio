import { fileURLToPath } from 'node:url';
import { inspectMigrationState } from './migration-plan.js';
import { readDatabaseConfig } from '../config/database.js';
import { MaintenanceError, runMaintenanceClient, withMaintenanceLock } from './maintenance.js';

export async function migrateDatabase(input: NodeJS.ProcessEnv, signal?: AbortSignal) {
  const env = { ...input };
  if (env.MIGRATION_WRITES_STOPPED !== 'true') throw new MaintenanceError();
  const config = readDatabaseConfig(env);
  return withMaintenanceLock(
    config,
    async (active) => {
      const before = await inspectMigrationState(config, active);
      if (before.empty && env.MIGRATION_INITIALIZE_EMPTY !== 'true') throw new MaintenanceError();
      if (before.pending.length === 0) return { applied: 0, total: before.expected.length };
      await runMaintenanceClient(
        process.execPath,
        ['node_modules/drizzle-kit/bin.cjs', 'migrate', '--config=drizzle.config.ts'],
        fileURLToPath(new URL('../../', import.meta.url)),
        env,
        active,
      );
      active.throwIfAborted();
      const after = await inspectMigrationState(config, active);
      if (
        after.empty ||
        after.pending.length !== 0 ||
        JSON.stringify(after.expected) !== JSON.stringify(before.expected)
      )
        throw new MaintenanceError();
      return { applied: before.pending.length, total: after.expected.length };
    },
    signal,
  );
}
