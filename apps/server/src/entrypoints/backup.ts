import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { readBackupRevision, recordBackupRevision } from '../operations/backup-revision.js';
import { readDatabaseConfig, databaseTargetFingerprint } from '../config/database.js';
import {
  BackupId,
  BackupByteLimit,
  DEFAULT_BACKUP_BYTES,
  IsolatedRestoreError,
  DailyBackupError,
  createBackup,
  copyBackup,
  dailyBackup,
  pruneBackups,
  restoreIsolated,
  verifyBackup,
} from '../operations/backup.js';

const controller = new AbortController();
const cancel = () => controller.abort();
process.once('SIGTERM', cancel);
process.once('SIGINT', cancel);
try {
  const [command, ...args] = process.argv.slice(2);
  const directory = z.string().refine(isAbsolute).parse(process.env.BACKUP_DIRECTORY);
  const options = {
    directory,
    dumpPath: process.env.MYSQLDUMP_PATH ?? '',
    mysqlPath: process.env.MYSQL_PATH ?? '',
    signal: controller.signal,
    maxBytes: BackupByteLimit.parse(
      process.env.BACKUP_MAX_BYTES ? Number(process.env.BACKUP_MAX_BYTES) : DEFAULT_BACKUP_BYTES,
    ),
  };
  if (['record-revision', 'pre-migration'].includes(command ?? '')) {
    if (args.length !== 2 || args[1] !== databaseTargetFingerprint(readDatabaseConfig()))
      throw Error('Backup target mismatch');
  }
  if (command === 'record-revision' && args.length === 2) {
    await recordBackupRevision(process.env.BACKUP_APPLICATION_REVISION_PATH, args[0]!);
    console.info(JSON.stringify({ event: 'backup_revision_recorded' }));
  } else if (command === 'pre-migration' && args.length === 2) {
    const revision = z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .parse(args[0]);
    const destination = z.string().refine(isAbsolute).parse(process.env.BACKUP_REPLICA_DIRECTORY);
    const result = await createBackup(
      options,
      readDatabaseConfig(),
      'pre-migration',
      revision,
      process.env.BACKUP_SCHEMA_STABLE === 'true',
      process.env.BACKUP_WRITES_STOPPED === 'true',
    );
    try {
      await copyBackup(options, result.id, destination, process.env.NODE_ENV === 'production');
    } catch {
      throw new DailyBackupError(result.id);
    }
    console.info(JSON.stringify({ event: 'pre_migration_backup_verified', id: result.id }));
  } else if (command === 'create') {
    if (args.length !== 2) throw Error('Invalid arguments');
    const kind = z.enum(['daily', 'pre-migration']).parse(args[0]),
      revision = z
        .string()
        .regex(/^[a-f0-9]{40}$/)
        .parse(args[1]);
    const result = await createBackup(
      options,
      readDatabaseConfig(),
      kind,
      revision,
      process.env.BACKUP_SCHEMA_STABLE === 'true',
      process.env.BACKUP_WRITES_STOPPED === 'true',
    );
    console.info(JSON.stringify({ event: 'backup_created', id: result.id, kind: result.kind }));
  } else if (command === 'copy' && args.length === 1) {
    const destination = z.string().refine(isAbsolute).parse(process.env.BACKUP_REPLICA_DIRECTORY);
    const result = await copyBackup(
      options,
      BackupId.parse(args[0]),
      destination,
      process.env.NODE_ENV === 'production',
    );
    console.info(JSON.stringify({ event: 'backup_copy_verified', id: result.id }));
  } else if (command === 'daily' && args.length === 0) {
    const destination = z.string().refine(isAbsolute).parse(process.env.BACKUP_REPLICA_DIRECTORY);
    const revision = await readBackupRevision(process.env);
    const result = await dailyBackup(
      options,
      readDatabaseConfig(),
      destination,
      revision,
      process.env.BACKUP_SCHEMA_STABLE === 'true',
    );
    console.info(JSON.stringify({ event: 'backup_daily_completed', ...result }));
  } else if (command === 'verify' && args.length === 1) {
    const result = await verifyBackup(options, BackupId.parse(args[0]));
    console.info(JSON.stringify({ event: 'backup_verified', id: result.id }));
  } else if (command === 'restore-isolated' && args.length === 1) {
    const result = await restoreIsolated(options, readDatabaseConfig(), BackupId.parse(args[0]));
    console.info(JSON.stringify({ event: 'isolated_restore_verified', tables: result.tables }));
  } else if (command === 'prune' && args.length === 0) {
    console.info(
      JSON.stringify({ event: 'backup_retention_finished', removed: await pruneBackups(options) }),
    );
  } else throw Error('Invalid arguments');
} catch (error) {
  console.error(
    JSON.stringify({
      event: 'backup_command_failed',
      retainedBackupId: error instanceof DailyBackupError ? error.retainedBackupId : undefined,
      isolatedTargetCreated: error instanceof IsolatedRestoreError && error.targetCreated,
      instruction:
        'Inspect private configuration, directory lock and isolated restore target; partial targets are retained',
    }),
  );
  process.exitCode = 1;
} finally {
  process.removeListener('SIGTERM', cancel);
  process.removeListener('SIGINT', cancel);
}
