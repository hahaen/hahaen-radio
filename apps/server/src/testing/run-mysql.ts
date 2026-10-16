import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import mysql from 'mysql2/promise';
import { readDatabaseConfig } from '../config/database.js';

const exec = promisify(execFile);
const serverPath = fileURLToPath(new URL('../../', import.meta.url));
const root = fileURLToPath(new URL('../../../../', import.meta.url));
let connection: mysql.Connection | undefined;
let created = false;
let temporary: string | undefined;
let name: string | undefined;
try {
  if (process.env.NODE_ENV !== 'test') throw new Error('Test environment required');
  const config = readDatabaseConfig();
  const { database, ssl } = config;
  const credentials = {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
  };
  name = database;
  connection = await mysql.createConnection({
    ...credentials,
    ...(ssl ? { ssl } : {}),
    charset: 'utf8mb4_general_ci',
    timezone: 'Z',
    connectTimeout: 8000,
  });
  const [existing] = await connection.query<mysql.RowDataPacket[]>(
    'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
    [database],
  );
  if (existing.length) throw new Error('Test database already exists');
  await connection.query(
    `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`,
  );
  created = true;
  await mkdir(join(root, '.local'), { recursive: true, mode: 0o700 });
  temporary = await mkdtemp(join(root, '.local', 'mysql-test-'));
  await mkdir(join(temporary, 'meta'), { mode: 0o700 });
  const journal = JSON.parse(
    await readFile(join(root, 'migrations/meta/_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  const first = journal.entries[0];
  if (!first) throw new Error('No initial migration');
  await copyFile(join(root, 'migrations', `${first.tag}.sql`), join(temporary, `${first.tag}.sql`));
  await writeFile(
    join(temporary, 'meta/_journal.json'),
    JSON.stringify({ ...journal, entries: [first] }),
    { mode: 0o600 },
  );
  const migrate = (path: string) =>
    exec(
      process.execPath,
      ['node_modules/drizzle-kit/bin.cjs', 'migrate', '--config=drizzle.test.config.ts'],
      {
        cwd: serverPath,
        env: { ...process.env, DB_TEST_MIGRATIONS_PATH: path },
        timeout: 120000,
        maxBuffer: 128 * 1024,
      },
    );
  await migrate(temporary);
  await connection.query(
    `INSERT INTO \`${database}\`.station_overrides (station_id, blocked, reason, updated_at) VALUES (?, 1, ?, UTC_TIMESTAMP(3))`,
    ['00000000-0000-4000-8000-000000000098', '迁移保留验证 🌊'],
  );
  await migrate(join(root, 'migrations'));
  await migrate(join(root, 'migrations'));
  await exec(
    'pnpm',
    ['exec', 'vitest', 'run', 'apps/server/src/db/catalog.mysql.test.ts', '--maxWorkers=1'],
    {
      cwd: root,
      env: { ...process.env, HAEN_MYSQL_TESTS: '1' },
      timeout: 120000,
      maxBuffer: 256 * 1024,
    },
  );
  console.info(
    JSON.stringify({
      event: 'mysql_acceptance_passed',
      scope: 'empty-init,upgrade,preservation,repeated-migration,repository',
    }),
  );
} catch (error) {
  if (temporary) {
    const archive = join(root, '.local/archive/mysql-tests');
    await mkdir(archive, { recursive: true, mode: 0o700 });
    const diagnostic = await mkdtemp(join(archive, 'failure-'));
    await writeFile(
      join(diagnostic, 'failure.txt'),
      error instanceof Error
        ? error.message +
            '\n' +
            String((error as { stdout?: string }).stdout ?? '') +
            '\n' +
            String((error as { stderr?: string }).stderr ?? '')
        : 'Unknown failure',
      { mode: 0o600 },
    );
  }
  console.error(
    JSON.stringify({
      event: 'mysql_acceptance_failed',
      diagnostic: temporary
        ? 'Private diagnostic retained under .local/archive/mysql-tests'
        : 'Database preflight failed',
    }),
  );
  process.exitCode = 1;
} finally {
  try {
    if (created && connection && name && /^ha_radio_test_[a-z0-9_]{1,40}$/.test(name))
      await connection.query(`DROP DATABASE \`${name}\``);
  } catch {
    console.error(JSON.stringify({ event: 'mysql_test_cleanup_failed' }));
    process.exitCode = 1;
  } finally {
    await connection?.end();
  }
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
