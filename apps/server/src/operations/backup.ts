import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
} from 'node:fs/promises';
import { isAbsolute, join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';
import mysql, { type Connection } from 'mysql2/promise';
import { z } from 'zod';
import type { DatabaseConfig } from '../config/database.js';
import { withMaintenanceLock } from './maintenance.js';

export class BackupError extends Error {}
export class DailyBackupError extends BackupError {
  constructor(readonly retainedBackupId: string) {
    super('Daily backup incomplete; verified primary retained');
  }
}
export class IsolatedRestoreError extends BackupError {
  constructor(readonly targetCreated: boolean) {
    super(targetCreated ? 'Restore failed; isolated target retained' : 'Restore refused');
  }
}
export const DEFAULT_BACKUP_BYTES = 1024 * 1024 * 1024;
export const BackupByteLimit = z
  .number()
  .int()
  .min(1024 * 1024)
  .max(100 * DEFAULT_BACKUP_BYTES);
const MAX_BYTES = 100 * DEFAULT_BACKUP_BYTES;
const Name = z.string().regex(/^[a-zA-Z0-9_]{1,64}$/);
const History = z
  .array(
    z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.string().regex(/^\d+$/) }),
  )
  .min(1)
  .max(1000);
export const BackupId = z.string().regex(/^haen-\d{8}T\d{9}Z-[a-f0-9]{12}$/);
export const BackupManifest = z
  .strictObject({
    format: z.literal(1),
    id: BackupId,
    kind: z.enum(['daily', 'pre-migration']),
    createdAt: z.iso.datetime(),
    sourceDatabase: Name,
    serverVersion: z.literal('8.0.46'),
    revision: z.string().regex(/^[a-f0-9]{40}$/),
    tables: z.array(Name).min(1).max(1000),
    migrations: History,
    counts: z.record(Name, z.string().regex(/^\d+$/)).nullable(),
    bytes: z.number().int().positive().max(MAX_BYTES),
    plainBytes: z.number().int().positive().max(MAX_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .superRefine((value, ctx) => {
    if (
      new Set(value.tables).size !== value.tables.length ||
      (value.kind === 'daily' && value.counts !== null) ||
      (value.kind === 'pre-migration' &&
        (!value.counts ||
          JSON.stringify(Object.keys(value.counts).sort()) !==
            JSON.stringify([...value.tables].sort())))
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid backup manifest invariants' });
  });
export type Manifest = z.infer<typeof BackupManifest>;
export interface BackupOptions {
  directory: string;
  dumpPath: string;
  mysqlPath: string;
  signal?: AbortSignal;
  maxBytes?: number;
}
const childEnvironment = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(DB_|MYSQL_|AUDD_|RECOGNITION_)|PASSWORD|TOKEN|SECRET/i.test(key),
    ),
  );
function fail(): never {
  throw new BackupError('Backup operation failed');
}
async function privatePath(path: string, directory: boolean) {
  const stat = await lstat(path);
  if (
    stat.isSymbolicLink() ||
    (directory ? !stat.isDirectory() : !stat.isFile()) ||
    (stat.mode & 0o777) !== (directory ? 0o700 : 0o600) ||
    (process.getuid && stat.uid !== process.getuid()) ||
    (!directory && stat.nlink !== 1)
  )
    fail();
  return stat;
}
async function lock<T>(
  directory: string,
  operation: () => Promise<T>,
  name: '.backup.lock' | '.backup-cycle.lock' = '.backup.lock',
) {
  if (!isAbsolute(directory)) fail();
  await privatePath(directory, true);
  const path = join(directory, name);
  const handle = await open(path, 'wx', 0o600);
  const inode = (await handle.stat()).ino;
  try {
    await handle.writeFile(
      JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
    );
    return await operation();
  } finally {
    await handle.close();
    const current = await lstat(path).catch(() => null);
    if (current?.ino === inode) await unlink(path);
  }
}
export function optionValue(value: string) {
  if (value.includes('\0')) fail();
  return (
    '"' +
    value
      .replaceAll('\\', '\\\\')
      .replaceAll('"', '\\"')
      .replaceAll('\n', '\\n')
      .replaceAll('\r', '\\r')
      .replaceAll('\t', '\\t') +
    '"'
  );
}
async function optionsFile<T>(
  base: string,
  config: DatabaseConfig,
  operation: (path: string) => Promise<T>,
) {
  const directory = await mkdtemp(join(base, '.client-'));
  try {
    const caPath = join(directory, 'ca.pem');
    if (config.ssl?.ca) {
      const file = await open(caPath, 'wx', 0o600);
      try {
        await file.writeFile(config.ssl.ca);
      } finally {
        await file.close();
      }
    }
    const values: Record<string, string> = {
      protocol: 'TCP',
      host: config.host,
      port: String(config.port),
      user: config.user,
      password: config.password,
      'default-character-set': 'utf8mb4',
      'ssl-mode': config.ssl ? 'VERIFY_IDENTITY' : 'DISABLED',
    };
    if (config.ssl?.ca) values['ssl-ca'] = caPath;
    const path = join(directory, 'client.cnf'),
      file = await open(path, 'wx', 0o600);
    try {
      await file.writeFile(
        '[client]\n' +
          Object.entries(values)
            .map(([key, value]) => key + '=' + optionValue(value))
            .join('\n') +
          '\n',
      );
    } finally {
      await file.close();
    }
    return await operation(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
async function client(
  path: string,
  args: string[],
  signal: AbortSignal | undefined,
  streams?: (child: ReturnType<typeof spawn>) => Promise<void>,
  timeoutMs = 300000,
) {
  if (!isAbsolute(path)) fail();
  const active = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
  const loginPath =
    (args.find((arg) => arg.startsWith('--defaults-file='))?.slice('--defaults-file='.length) ??
      join(tmpdir(), 'haen-client-' + randomBytes(12).toString('hex'))) + '.unused-login';
  const child = spawn(path, args, {
    env: { ...childEnvironment(), MYSQL_TEST_LOGIN_FILE: loginPath },
    stdio: ['pipe', 'pipe', 'pipe'],
    signal: active,
  });
  let output = '';
  child.stderr?.resume();
  if (!streams) {
    child.stdin?.end();
    child.stdout?.on('data', (chunk: Buffer) => {
      if (output.length < 8192) output += chunk.toString().slice(0, 8192 - output.length);
    });
  }
  const finished = new Promise<void>((resolve, reject) => {
    child.once('error', () => reject(new BackupError('Client failed')));
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(new BackupError('Client failed')),
    );
  });
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  const pumping = Promise.resolve().then(() => streams?.(child));
  try {
    await Promise.all([finished, pumping]);
    return output;
  } catch {
    child.kill('SIGTERM');
    child.stdin?.destroy();
    child.stdout?.destroy();
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000).unref();
    await closed;
    await Promise.allSettled([finished, pumping]);
    clearTimeout(timer);
    fail();
  }
}
async function version(path: string, signal?: AbortSignal) {
  if (
    !/\b8\.0\.46\b/.test(
      await client(path, ['--no-defaults', '--version'], signal, undefined, 5000),
    )
  )
    fail();
}
async function connect(config: DatabaseConfig, select = true) {
  if (!/^(ha_radio|ha_radio_dev|ha_radio_test_[a-z0-9_]{1,40})$/.test(config.database)) fail();
  if (
    (!config.ssl &&
      (!['localhost', '127.0.0.1', '::1'].includes(config.host) ||
        config.database === 'ha_radio')) ||
    (config.ssl && (!config.ssl.rejectUnauthorized || !config.ssl.verifyIdentity))
  )
    fail();
  const { database, ssl } = config;
  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    ...(ssl ? { ssl } : {}),
    ...(select ? { database } : {}),
    charset: 'utf8mb4_general_ci',
    timezone: 'Z',
    connectTimeout: 8000,
  });
  const deadline = setTimeout(() => connection.destroy(), 10000).unref();
  try {
    await connection.query("SET time_zone = '+00:00'");
    const [rows] = await connection.query(
      'SELECT VERSION() AS version, @@collation_connection AS collation, @@session.time_zone AS zone',
    );
    const [row] = z
      .array(
        z.object({
          version: z.string(),
          collation: z.literal('utf8mb4_general_ci'),
          zone: z.literal('+00:00'),
        }),
      )
      .length(1)
      .parse(rows);
    if (row!.version.split('-')[0] !== '8.0.46') fail();
    return connection;
  } catch (error) {
    await connection.end();
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}
export function validateBackupGrants(grants: string[], database: string) {
  Name.parse(database);
  const scoped = new Set<string>(),
    global = new Set<string>();
  for (const statement of grants) {
    const match = /^GRANT (.+) ON (.+) TO /i.exec(statement);
    if (!match) continue;
    const target = match[2]!.replaceAll('`', '').replaceAll('\\_', '_').toLowerCase();
    const privileges = match[1]!
      .toUpperCase()
      .split(',')
      .map((value) => value.trim());
    if (target === '*.*')
      for (const value of privileges) {
        global.add(value);
        scoped.add(value);
      }
    if (target === database.toLowerCase() + '.*') for (const value of privileges) scoped.add(value);
  }
  if (!global.has('ALL PRIVILEGES') && !global.has('SHOW_ROUTINE') && !global.has('SELECT')) fail();
  if (
    !scoped.has('ALL PRIVILEGES') &&
    ['SELECT', 'SHOW VIEW', 'TRIGGER', 'EVENT'].some((value) => !scoped.has(value))
  )
    fail();
}
async function checkBackupIdentity(connection: Connection, database: string) {
  const [rows] = await connection.query('SHOW GRANTS FOR CURRENT_USER');
  const grants = z
    .array(z.record(z.string(), z.string()))
    .parse(rows)
    .flatMap((row) => Object.values(row));
  validateBackupGrants(grants, database);
}
async function history(connection: Connection) {
  const [rows] = await connection.query(
    'SELECT hash, created_at FROM __drizzle_migrations ORDER BY id',
  );
  return History.parse(
    z
      .array(z.object({ hash: z.string(), created_at: z.union([z.string(), z.number()]) }))
      .parse(rows)
      .map((row) => ({ hash: row.hash, createdAt: String(row.created_at) })),
  );
}
async function tables(connection: Connection, database: string) {
  const [rows] = await connection.execute(
    'SELECT TABLE_NAME AS name, TABLE_TYPE AS type, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME',
    [database],
  );
  const values = z
    .array(z.object({ name: Name, type: z.literal('BASE TABLE'), engine: z.literal('InnoDB') }))
    .min(1)
    .max(1000)
    .parse(rows);
  for (const [table, field] of [
    ['TRIGGERS', 'TRIGGER_SCHEMA'],
    ['ROUTINES', 'ROUTINE_SCHEMA'],
    ['EVENTS', 'EVENT_SCHEMA'],
  ] as const) {
    const [objects] = await connection.execute(
      `SELECT COUNT(*) AS count FROM information_schema.${table} WHERE ${field} = ?`,
      [database],
    );
    if (z.array(z.object({ count: z.coerce.number() })).parse(objects)[0]?.count !== 0) fail();
  }
  const [foreign] = await connection.execute(
    'SELECT COUNT(*) AS count FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_SCHEMA IS NOT NULL AND REFERENCED_TABLE_SCHEMA <> ?',
    [database, database],
  );
  if (z.array(z.object({ count: z.coerce.number() })).parse(foreign)[0]?.count !== 0) fail();
  return values.map((row) => row.name);
}
async function counts(connection: Connection, names: string[]) {
  const result: [string, string][] = [];
  for (const name of names) {
    Name.parse(name);
    const [rows] = await connection.query('SELECT COUNT(*) AS count FROM `' + name + '`');
    result.push([
      name,
      String(z.array(z.object({ count: z.union([z.string(), z.number()]) })).parse(rows)[0]!.count),
    ]);
  }
  return Object.fromEntries(result);
}
const same = (a: unknown, b: unknown) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) fail();
};
function counter(update: (size: number) => void) {
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      try {
        update(chunk.length);
        done(null, chunk);
      } catch {
        done(new BackupError('Backup exceeds limit'));
      }
    },
  });
}
async function inspect(
  directory: string,
  id: string,
  limit: number,
  signal?: AbortSignal,
): Promise<Manifest> {
  signal?.throwIfAborted();
  BackupId.parse(id);
  const path = join(directory, id);
  await privatePath(path, true);
  same((await readdir(path)).sort(), ['dump.sql.gz', 'manifest.json']);
  const meta = await privatePath(join(path, 'manifest.json'), false);
  if (meta.size > 1024 * 1024) fail();
  const manifest = BackupManifest.parse(
    JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8')),
  );
  if (manifest.id !== id || manifest.bytes > limit || manifest.plainBytes > limit) fail();
  const dump = join(path, 'dump.sql.gz'),
    stat = await privatePath(dump, false);
  if (stat.size !== manifest.bytes) fail();
  const hash = createHash('sha256');
  let bytes = 0,
    plain = 0;
  await pipeline(
    createReadStream(dump),
    new Transform({
      transform(chunk: Buffer, _enc, done) {
        bytes += chunk.length;
        hash.update(chunk);
        done(null, chunk);
      },
    }),
    createGunzip(),
    new Writable({
      write(chunk: Buffer, _enc, done) {
        plain += chunk.length;
        done(plain > limit ? new BackupError('Backup exceeds limit') : undefined);
      },
    }),
    signal ? { signal } : {},
  );
  if (
    bytes !== manifest.bytes ||
    plain !== manifest.plainBytes ||
    hash.digest('hex') !== manifest.sha256
  )
    fail();
  return manifest;
}
export const verifyBackup = (
  options: Pick<BackupOptions, 'directory' | 'maxBytes' | 'signal'>,
  id: string,
) =>
  lock(options.directory, () =>
    inspect(
      options.directory,
      id,
      BackupByteLimit.parse(options.maxBytes ?? DEFAULT_BACKUP_BYTES),
      options.signal,
    ),
  );
export async function createBackup(
  options: BackupOptions,
  config: DatabaseConfig,
  kind: Manifest['kind'],
  revision: string,
  stable: boolean,
  stopped: boolean,
) {
  const limit = BackupByteLimit.parse(options.maxBytes ?? DEFAULT_BACKUP_BYTES);
  BackupManifest.shape.kind.parse(kind);
  if (!stable || (kind === 'pre-migration' && !stopped)) fail();
  BackupManifest.shape.revision.parse(revision);
  return lock(options.directory, async () => {
    options.signal?.throwIfAborted();
    await version(options.dumpPath, options.signal);
    return withMaintenanceLock(
      config,
      async (signal) => {
        const connection = await connect(config),
          id =
            'haen-' +
            new Date().toISOString().replaceAll('-', '').replaceAll(':', '').replace('.', '') +
            '-' +
            randomBytes(6).toString('hex');
        BackupId.parse(id);
        const directory = join(options.directory, id);
        let complete = false;
        const cancel = () => connection.destroy();
        signal.addEventListener('abort', cancel, { once: true });
        const deadline = setTimeout(() => connection.destroy(), 330000).unref();
        try {
          signal.throwIfAborted();
          await checkBackupIdentity(connection, config.database);
          const names = await tables(connection, config.database),
            migrations = await history(connection);
          const rowCounts = kind === 'pre-migration' ? await counts(connection, names) : null;
          await mkdir(directory, { mode: 0o700 });
          const hash = createHash('sha256');
          let bytes = 0,
            plainBytes = 0;
          await optionsFile(options.directory, config, (path) =>
            client(
              options.dumpPath,
              [
                '--defaults-file=' + path,
                '--single-transaction',
                '--quick',
                '--skip-lock-tables',
                '--skip-add-locks',
                '--skip-add-drop-table',
                '--no-tablespaces',
                '--set-gtid-purged=OFF',
                '--column-statistics=0',
                '--hex-blob',
                '--skip-comments',
                '--routines',
                '--events',
                '--triggers',
                config.database,
              ],
              signal,
              (child) => {
                child.stdin?.end();
                return pipeline(
                  child.stdout!,
                  counter((size) => {
                    plainBytes += size;
                    if (plainBytes > limit) fail();
                  }),
                  createGzip(),
                  new Transform({
                    transform(chunk: Buffer, _enc, done) {
                      bytes += chunk.length;
                      if (bytes > limit) return done(new BackupError('Backup exceeds limit'));
                      hash.update(chunk);
                      done(null, chunk);
                    },
                  }),
                  createWriteStream(join(directory, 'dump.sql.gz'), { flags: 'wx', mode: 0o600 }),
                  { signal },
                );
              },
            ),
          ).then(() => undefined);
          same(await tables(connection, config.database), names);
          same(await history(connection), migrations);
          if (rowCounts) same(await counts(connection, names), rowCounts);
          const manifest = BackupManifest.parse({
            format: 1,
            id,
            kind,
            createdAt: new Date().toISOString(),
            sourceDatabase: config.database,
            serverVersion: '8.0.46',
            revision,
            tables: names,
            migrations,
            counts: rowCounts,
            bytes,
            plainBytes,
            sha256: hash.digest('hex'),
          });
          const dumpHandle = await open(join(directory, 'dump.sql.gz'), 'r+');
          try {
            await dumpHandle.sync();
          } finally {
            await dumpHandle.close();
          }
          const handle = await open(join(directory, 'manifest.pending'), 'wx', 0o600);
          try {
            await handle.writeFile(JSON.stringify(manifest, null, 2) + '\n');
            await handle.sync();
          } finally {
            await handle.close();
          }
          await rename(join(directory, 'manifest.pending'), join(directory, 'manifest.json'));
          await inspect(
            options.directory,
            id,
            BackupByteLimit.parse(options.maxBytes ?? DEFAULT_BACKUP_BYTES),
            signal,
          );
          complete = true;
          return manifest;
        } finally {
          signal.removeEventListener('abort', cancel);
          clearTimeout(deadline);
          await connection.end();
          if (!complete) await rm(directory, { recursive: true, force: true });
        }
      },
      options.signal,
    );
  });
}
export async function restoreIsolated(options: BackupOptions, config: DatabaseConfig, id: string) {
  if (!/^ha_radio_test_restore_[a-z0-9_]{1,24}$/.test(config.database)) fail();
  return lock(options.directory, async () => {
    const manifest = await inspect(
      options.directory,
      id,
      BackupByteLimit.parse(options.maxBytes ?? DEFAULT_BACKUP_BYTES),
      options.signal,
    );
    await version(options.mysqlPath, options.signal);
    const connection = await connect(config, false);
    let created = false;
    const deadline = setTimeout(() => connection.destroy(), 330000).unref();
    try {
      const [existing] = await connection.execute(
        'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
        [config.database],
      );
      if (z.array(z.unknown()).parse(existing).length) fail();
      await connection.query(
        'CREATE DATABASE `' +
          config.database +
          '` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci',
      );
      created = true;
      await optionsFile(options.directory, config, (path) =>
        client(
          options.mysqlPath,
          ['--defaults-file=' + path, '--binary-mode', '--local-infile=0', config.database],
          options.signal,
          async (child) => {
            child.stdout!.resume();
            await pipeline(
              createReadStream(join(options.directory, id, 'dump.sql.gz')),
              createGunzip(),
              child.stdin!,
              options.signal ? { signal: options.signal } : {},
            );
          },
        ),
      );
      await connection.query('USE `' + config.database + '`');
      same(await tables(connection, config.database), manifest.tables);
      same(await history(connection), manifest.migrations);
      if (manifest.counts) same(await counts(connection, manifest.tables), manifest.counts);
      return { restored: true, tables: manifest.tables.length };
    } catch {
      throw new IsolatedRestoreError(created);
    } finally {
      clearTimeout(deadline);
      await connection.end();
    }
  });
}
type BackupFiles = Pick<BackupOptions, 'directory' | 'maxBytes' | 'signal'>;
export function pruneBackups(options: BackupFiles) {
  return lock(options.directory, () => pruneWithinCycle(options), '.backup-cycle.lock');
}
function pruneWithinCycle(options: BackupFiles) {
  return lock(options.directory, async () => {
    const names = (await readdir(options.directory)).filter(
      (name) => BackupId.safeParse(name).success,
    );
    if (names.length > 1000) fail();
    const entries: Manifest[] = [];
    for (const name of names)
      entries.push(
        await inspect(
          options.directory,
          name,
          BackupByteLimit.parse(options.maxBytes ?? DEFAULT_BACKUP_BYTES),
          options.signal,
        ),
      );
    let removed = 0;
    for (const kind of ['daily', 'pre-migration'] as const) {
      const sorted = entries
        .filter((item) => item.kind === kind)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      options.signal?.throwIfAborted();
      for (const item of sorted.slice(kind === 'daily' ? 7 : 3)) {
        options.signal?.throwIfAborted();
        await rm(join(options.directory, item.id), { recursive: true });
        removed++;
      }
    }
    return removed;
  });
}

async function replicaDirectories(source: string, destination: string, distinctDevice: boolean) {
  if (!isAbsolute(source) || !isAbsolute(destination)) fail();
  const a = await privatePath(source, true),
    b = await privatePath(destination, true);
  const sourcePath = await realpath(source),
    destinationPath = await realpath(destination);
  if (
    sourcePath === destinationPath ||
    sourcePath.startsWith(destinationPath + sep) ||
    destinationPath.startsWith(sourcePath + sep) ||
    (distinctDevice && a.dev === b.dev)
  )
    fail();
}

export async function copyBackup(
  options: Pick<BackupOptions, 'directory' | 'maxBytes' | 'signal'>,
  id: string,
  destination: string,
  distinctDevice = false,
) {
  await replicaDirectories(options.directory, destination, distinctDevice);
  const limit = BackupByteLimit.parse(options.maxBytes ?? DEFAULT_BACKUP_BYTES);
  return lock(options.directory, () =>
    lock(destination, async () => {
      const original = await inspect(options.directory, id, limit, options.signal);
      const target = join(destination, id);
      const existing = await lstat(target).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        return undefined;
      });
      if (existing) {
        same(await inspect(destination, id, limit, options.signal), original);
        return original;
      }
      // Exclusive directory creation claims only this new target. Manifest publishes last.
      await mkdir(target, { mode: 0o700 });
      let complete = false;
      try {
        let bytes = 0;
        await pipeline(
          createReadStream(join(options.directory, id, 'dump.sql.gz')),
          counter((size) => {
            bytes += size;
            if (bytes > limit) fail();
          }),
          createWriteStream(join(target, 'dump.sql.gz'), { flags: 'wx', mode: 0o600 }),
          options.signal ? { signal: options.signal } : {},
        );
        const dump = await open(join(target, 'dump.sql.gz'), 'r+');
        try {
          await dump.sync();
        } finally {
          await dump.close();
        }
        options.signal?.throwIfAborted();
        const manifest = await open(join(target, 'manifest.pending'), 'wx', 0o600);
        try {
          await manifest.writeFile(JSON.stringify(original, null, 2) + '\n');
          await manifest.sync();
        } finally {
          await manifest.close();
        }
        await rename(join(target, 'manifest.pending'), join(target, 'manifest.json'));
        same(await inspect(destination, id, limit, options.signal), original);
        complete = true;
        return original;
      } finally {
        if (!complete) await rm(target, { recursive: true, force: true });
      }
    }),
  );
}

export async function dailyBackup(
  options: BackupOptions,
  config: DatabaseConfig,
  destination: string,
  revision: string,
  stable: boolean,
) {
  const distinctDevice = config.database === 'ha_radio';
  await replicaDirectories(options.directory, destination, distinctDevice);
  return lock(
    options.directory,
    async () => {
      const manifest = await createBackup(options, config, 'daily', revision, stable, false);
      // A copy failure keeps the new primary and all old backups for operator recovery.
      try {
        await copyBackup(options, manifest.id, destination, distinctDevice);
      } catch {
        throw new DailyBackupError(manifest.id);
      }
      const replicaRemoved = await pruneBackups({ ...options, directory: destination });
      const primaryRemoved = await pruneWithinCycle(options);
      return { id: manifest.id, replicaRemoved, primaryRemoved };
    },
    '.backup-cycle.lock',
  );
}
