import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { z } from 'zod';
import { getTableConfig } from 'drizzle-orm/mysql-core';
import * as schema from '../db/schema.js';
import type { DatabaseConfig } from '../config/database.js';
import { openDatabase } from '../db/connection.js';
import { validateBackupGrants } from './backup.js';
import { MaintenanceError, withMaintenanceLock } from './maintenance.js';

export const migrationFolder = fileURLToPath(new URL('../../../../migrations/', import.meta.url));
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Time = z.string().regex(/^[1-9][0-9]*$/);
const History = z.array(z.object({ hash: Hash, createdAt: Time })).max(1000);
export type MigrationRecord = z.infer<typeof History>[number];
export async function expectedMigrations(folder = migrationFolder) {
  const journal = z
    .object({
      entries: z
        .array(
          z.object({
            idx: z.number().int().nonnegative(),
            when: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
            tag: z.string().regex(/^\d{4}_[a-z0-9_]+$/),
          }),
        )
        .min(1)
        .max(1000),
    })
    .parse(JSON.parse(await readFile(join(folder, 'meta/_journal.json'), 'utf8')));
  const unique = new Set<string>();
  for (const [index, entry] of journal.entries.entries()) {
    if (
      entry.idx !== index ||
      unique.has(entry.tag) ||
      (index > 0 && entry.when <= journal.entries[index - 1]!.when)
    )
      throw new MaintenanceError();
    unique.add(entry.tag);
  }
  const files = readMigrationFiles({ migrationsFolder: folder });
  const result = [];
  for (const [index, file] of files.entries()) {
    const snapshot = z
      .object({
        version: z.literal('5'),
        dialect: z.literal('mysql'),
        tables: z.record(z.string(), z.object({ name: z.string().regex(/^[a-z0-9_]{1,64}$/) })),
      })
      .parse(
        JSON.parse(
          await readFile(
            join(folder, 'meta', String(index).padStart(4, '0') + '_snapshot.json'),
            'utf8',
          ),
        ),
      );
    const tables = Object.values(snapshot.tables)
      .map((table) => table.name)
      .sort();
    if (
      tables.length === 0 ||
      tables.length > 1000 ||
      new Set(tables).size !== tables.length ||
      tables.includes('__drizzle_migrations')
    )
      throw new MaintenanceError();
    result.push({
      file: journal.entries[index]!.tag + '.sql',
      hash: Hash.parse(file.hash),
      createdAt: Time.parse(String(file.folderMillis)),
      tables,
    });
  }
  return result;
}
export function pendingMigrations<T extends MigrationRecord>(expected: T[], applied: unknown) {
  const rows = History.parse(applied);
  if (rows.length > expected.length) throw new MaintenanceError();
  for (const [index, row] of rows.entries()) {
    const match = expected[index];
    if (match?.hash !== row.hash || match.createdAt !== row.createdAt) throw new MaintenanceError();
  }
  return expected.slice(rows.length);
}
/** Read-only inspection. Caller holds the project maintenance lock. */
export async function inspectMigrationState(
  config: DatabaseConfig,
  signal: AbortSignal,
  folder = migrationFolder,
) {
  const expected = await expectedMigrations(folder);
  const currentTables = Object.values(schema)
    .map((table) => getTableConfig(table).name)
    .sort();
  if (JSON.stringify(expected.at(-1)!.tables) !== JSON.stringify(currentTables))
    throw new MaintenanceError();
  signal.throwIfAborted();
  const database = await openDatabase({ ...config, connectionLimit: 1 });
  try {
    return await database.run(async (session) => {
      const [rawGrants] = await session.execute('SHOW GRANTS FOR CURRENT_USER');
      const grants = z
        .array(z.record(z.string(), z.string()))
        .parse(rawGrants)
        .flatMap((row) => Object.values(row));
      validateBackupGrants(grants, config.database);
      signal.throwIfAborted();
      const [rawTables] = await session.execute(
        'SELECT TABLE_NAME AS name, TABLE_TYPE AS kind, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME LIMIT 1001',
      );
      const tables = z
        .array(
          z.object({
            name: z.string(),
            kind: z.literal('BASE TABLE'),
            engine: z.literal('InnoDB'),
          }),
        )
        .max(1000)
        .parse(rawTables);
      for (const [table, field] of [
        ['ROUTINES', 'ROUTINE_SCHEMA'],
        ['TRIGGERS', 'TRIGGER_SCHEMA'],
        ['EVENTS', 'EVENT_SCHEMA'],
      ] as const) {
        signal.throwIfAborted();
        const [objects] = await session.execute(
          `SELECT COUNT(*) AS count FROM information_schema.${table} WHERE ${field}=DATABASE()`,
        );
        if (
          z
            .array(z.object({ count: z.coerce.number() }))
            .length(1)
            .parse(objects)[0]!.count !== 0
        )
          throw new MaintenanceError();
      }
      signal.throwIfAborted();
      if (tables.length === 0)
        return { empty: true, tables: 0, expected, applied: [], pending: expected };
      if (!tables.some((table) => table.name === '__drizzle_migrations'))
        throw new MaintenanceError();
      const [rawHistory] = await session.execute(
        'SELECT hash,created_at FROM __drizzle_migrations ORDER BY id LIMIT 1001',
      );
      const applied = z
        .array(
          z.object({
            hash: Hash,
            created_at: z.union([z.number().int().positive().max(Number.MAX_SAFE_INTEGER), Time]),
          }),
        )
        .min(1)
        .max(1000)
        .parse(rawHistory)
        .map((row) => ({ hash: row.hash, createdAt: String(row.created_at) }));
      const pending = pendingMigrations(expected, applied);
      const physicalTables = [
        ...expected[applied.length - 1]!.tables,
        '__drizzle_migrations',
      ].sort();
      if (
        JSON.stringify(tables.map((table) => table.name).sort()) !== JSON.stringify(physicalTables)
      )
        throw new MaintenanceError();
      signal.throwIfAborted();
      return { empty: false, tables: tables.length, expected, applied, pending };
    });
  } finally {
    await database.close();
  }
}
export function migrationStatus(config: DatabaseConfig, signal?: AbortSignal) {
  return withMaintenanceLock(config, (active) => inspectMigrationState(config, active), signal);
}
