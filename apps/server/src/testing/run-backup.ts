import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { openSync, closeSync } from 'node:fs';
import { mkdir, mkdtemp, cp, rm, writeFile, readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { readDatabaseConfig } from '../config/database.js';
import { openDatabase } from '../db/connection.js';
import { createCatalogRepository } from '../modules/catalog/repository.js';
import { synchronizeCatalog } from '../modules/catalog/sync.js';
import { normalizeStation } from '../modules/catalog/normalize.js';
import { BackupManifest } from '../operations/backup.js';
import {
  withMaintenanceLock,
  maintenanceKey,
  runMaintenanceClient,
} from '../operations/maintenance.js';
const root = fileURLToPath(new URL('../../../../', import.meta.url)),
  server = join(root, 'apps/server'),
  exec = promisify(execFile);
let admin: Connection | undefined,
  sourceCreated = false,
  restoreOwned = false,
  work: string | undefined;
let api: ReturnType<typeof spawn> | undefined, apiExited: Promise<number | null> | undefined;
const restoreName = 'ha_radio_test_restore_' + randomBytes(6).toString('hex');
let source = '';
const maintenanceController = new AbortController();
let maintenance: Promise<boolean> | undefined;
try {
  if (
    process.env.NODE_ENV !== 'test' ||
    !/^ha_radio_test_backup_[a-z0-9_]{1,24}$/.test(process.env.DB_NAME ?? '')
  )
    throw Error('Dedicated test source required');
  const config = readDatabaseConfig();
  source = config.database;
  const { ssl } = config;
  admin = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    charset: 'utf8mb4_general_ci',
    timezone: 'Z',
    connectTimeout: 8000,
    ...(ssl ? { ssl } : {}),
  });
  const exists = async (name: string) => {
    const [rows] = await admin!.execute<RowDataPacket[]>(
      'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',
      [name],
    );
    return rows.length > 0;
  };
  assert(!(await exists(source)));
  assert(!(await exists(restoreName)));
  await admin.query(
    'CREATE DATABASE `' + source + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci',
  );
  sourceCreated = true;
  const migrate = async (stopped: boolean, success: boolean) => {
    const outcome = await exec(process.execPath, ['dist/entrypoints/migrate.js'], {
      cwd: server,
      env: { ...process.env, MIGRATION_WRITES_STOPPED: String(stopped) },
      timeout: 120000,
      maxBuffer: 32768,
    }).then(
      () => true,
      () => false,
    );
    assert.equal(outcome, success);
  };
  await migrate(false, false);
  await withMaintenanceLock(config, () => migrate(true, false));
  const [empty] = await admin.execute<RowDataPacket[]>(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=?',
    [source],
  );
  assert.equal(empty.length, 0);
  await migrate(true, true);
  await migrate(true, true);
  const database = await openDatabase(config);
  const station = normalizeStation({
    stationuuid: '00000000-0000-4000-8000-000000000001',
    name: '恢复验证 🌊 "quoted" \\ 中文',
    url: 'https://radio.example/live',
    lastcheckok: 1,
  })!;
  try {
    await synchronizeCatalog(createCatalogRepository(database), {
      load: async () => ({ stations: [station], sourceCount: 1, invalidCount: 0 }),
    });
  } finally {
    await database.close();
  }
  const note = '迁移前备份 🌊 "引号" \\ 路径\n换行';
  await admin.query(
    'INSERT INTO `' +
      source +
      '`.station_overrides(station_id,blocked,reason,updated_at) VALUES(?,1,?,UTC_TIMESTAMP(3))',
    ['00000000-0000-4000-8000-000000000098', note],
  );
  await admin.query(
    'UPDATE `' +
      source +
      '`.diagnostic_limits SET accepted_count=7,period_day=DATE_FORMAT(UTC_TIMESTAMP(),"%Y-%m-%d") WHERE id=1',
  );
  const privateRoot = join(root, '.local/archive/backup-tests');
  await mkdir(privateRoot, { recursive: true, mode: 0o700 });
  work = await mkdtemp(join(privateRoot, 'run-'));
  const primary = join(work, 'primary'),
    secondary = join(work, 'independent-copy');
  await mkdir(primary, { mode: 0o700 });
  await mkdir(secondary, { mode: 0o700 });
  // Terminate only this test's owning lock session, never an unrelated session.
  const readyPath = join(work, 'maintenance-child.pid');
  maintenance = withMaintenanceLock(
    config,
    (active) =>
      runMaintenanceClient(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          'import{writeFileSync}from"node:fs";process.on("SIGTERM",()=>{});writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000);',
          readyPath,
        ],
        server,
        {},
        active,
        15000,
      ),
    maintenanceController.signal,
  ).then(
    () => false,
    () => true,
  );
  let ownedPid = 0;
  for (let attempt = 0; attempt < 100 && !ownedPid; attempt++) {
    ownedPid = Number(await readFile(readyPath, 'utf8').catch(() => '0'));
    if (!ownedPid) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const beforeLoss = performance.now();
  if (ownedPid) {
    const [owners] = await admin.execute<RowDataPacket[]>('SELECT IS_USED_LOCK(?) AS owner', [
      maintenanceKey(source),
    ]);
    const owner = owners[0]!.owner;
    assert(Number.isSafeInteger(owner) && owner > 0);
    await admin.query('KILL CONNECTION ' + owner);
  }
  assert(await maintenance);
  const lockLossMs = Math.round(performance.now() - beforeLoss);
  assert(lockLossMs < 6000);
  maintenance = undefined;
  assert(ownedPid > 0);
  assert.throws(() => process.kill(ownedPid, 0));
  await rm(readyPath);
  const env = {
    ...process.env,
    BACKUP_DIRECTORY: primary,
    BACKUP_SCHEMA_STABLE: 'true',
    BACKUP_WRITES_STOPPED: 'true',
  };
  const cli = async (args: string[], extra: Record<string, string> = {}, success = true) => {
    const result = await exec(process.execPath, ['dist/entrypoints/backup.js', ...args], {
      cwd: server,
      env: { ...env, ...extra },
      timeout: 120000,
      maxBuffer: 32768,
    }).then(
      (r) => ({ code: 0, ...r }),
      (error: unknown) => ({
        code: 1,
        stdout:
          error instanceof Error && 'stdout' in error && typeof error.stdout === 'string'
            ? error.stdout
            : '',
        stderr:
          error instanceof Error && 'stderr' in error && typeof error.stderr === 'string'
            ? error.stderr
            : '',
      }),
    );
    if (extra.DB_NAME === restoreName && result.stderr.includes('"isolatedTargetCreated":true'))
      restoreOwned = true;
    assert.equal(result.code, success ? 0 : 1);
    assert(!result.stdout.includes(config.password));
    assert(!result.stderr.includes(config.password));
    return result.stdout.trim();
  };
  const started = performance.now();
  const created = JSON.parse(await cli(['create', 'pre-migration', 'a'.repeat(40)])) as {
    id: string;
  };
  const manifest = BackupManifest.parse(
    JSON.parse(await readFile(join(primary, created.id, 'manifest.json'), 'utf8')),
  );
  await cli(['verify', created.id]);
  await withMaintenanceLock(config, () =>
    cli(['create', 'pre-migration', 'a'.repeat(40)], {}, false),
  );
  assert.deepEqual(await readdir(primary), [created.id]);
  await admin.query('CREATE VIEW `' + source + '`.unsupported_backup_view AS SELECT 1 AS value');
  try {
    await cli(['create', 'pre-migration', 'a'.repeat(40)], {}, false);
  } finally {
    await admin.query('DROP VIEW `' + source + '`.unsupported_backup_view');
  }
  await cp(join(primary, created.id), join(secondary, created.id), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  await rm(join(primary, created.id), { recursive: true });
  await cli(['verify', created.id], { BACKUP_DIRECTORY: secondary });
  await cli(['restore-isolated', created.id], {
    BACKUP_DIRECTORY: secondary,
    DB_NAME: restoreName,
  });
  restoreOwned = true;
  const elapsedMs = Math.round(performance.now() - started);
  await cli(
    ['restore-isolated', created.id],
    { BACKUP_DIRECTORY: secondary, DB_NAME: restoreName },
    false,
  );
  await cli(
    ['restore-isolated', created.id],
    { BACKUP_DIRECTORY: secondary, DB_NAME: 'ha_radio_dev' },
    false,
  );
  const [restored] = await admin.execute<RowDataPacket[]>(
    'SELECT reason FROM `' + restoreName + '`.station_overrides WHERE station_id=?',
    ['00000000-0000-4000-8000-000000000098'],
  );
  assert.equal(restored[0]!.reason, note);
  const [quota] = await admin.query<RowDataPacket[]>(
    'SELECT accepted_count FROM `' + restoreName + '`.diagnostic_limits',
  );
  assert.equal(quota[0]!.accepted_count, 7);
  await assert.rejects(
    admin.query(
      'UPDATE `' + restoreName + '`.diagnostic_limits SET accepted_count=1001 WHERE id=1',
    ),
  );
  const metadata = async (name: string) => {
    const [tables] = await admin!.execute(
      'SELECT TABLE_NAME,ENGINE,TABLE_COLLATION,ROW_FORMAT FROM information_schema.TABLES WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME',
      [name],
    );
    const [constraints] = await admin!.execute(
      'SELECT TABLE_NAME,CONSTRAINT_NAME,CONSTRAINT_TYPE FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME,CONSTRAINT_NAME',
      [name],
    );
    return { tables, constraints };
  };
  assert.deepEqual(await metadata(source), await metadata(restoreName));
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const address = socket.address();
  assert(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const fd = openSync(join(work, 'restored-api.log'), 'w', 0o600);
  api = spawn(process.execPath, ['dist/entrypoints/api.js'], {
    cwd: server,
    env: {
      ...env,
      DB_NAME: restoreName,
      HOST: '127.0.0.1',
      PORT: String(port),
      RECOGNITION_ENABLED: 'false',
      API_DOCS_ENABLED: 'false',
    },
    stdio: ['ignore', fd, fd],
  });
  closeSync(fd);
  apiExited = new Promise((resolve) => {
    api!.once('exit', resolve);
    api!.once('error', () => resolve(-1));
  });
  const url = 'http://127.0.0.1:' + port;
  let ready = false;
  for (let n = 0; n < 100; n++) {
    assert(api.exitCode === null && api.signalCode === null);
    try {
      if ((await fetch(url + '/api/v1/health/ready', { signal: AbortSignal.timeout(1000) })).ok) {
        ready = true;
        break;
      }
    } catch {
      // The owned API can still be binding within this bounded readiness window.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(ready);
  const detail = (await (await fetch(url + '/api/v1/stations/' + station.id)).json()) as {
    name: string;
  };
  assert.equal(detail.name, station.name);
  api.kill('SIGTERM');
  assert.equal(await apiExited, 0);
  api = undefined;
  await writeFile(join(secondary, created.id, 'dump.sql.gz'), 'tampered', { mode: 0o600 });
  await cli(['verify', created.id], { BACKUP_DIRECTORY: secondary }, false);
  const untouched = 'ha_radio_test_restore_' + randomBytes(6).toString('hex');
  await cli(
    ['restore-isolated', created.id],
    { BACKUP_DIRECTORY: secondary, DB_NAME: untouched },
    false,
  );
  assert(!(await exists(untouched)));
  assert(
    !(await readdir(primary)).some(
      (name) => name.startsWith('.client-') || name === '.backup.lock',
    ),
  );
  assert(
    !(await readdir(secondary)).some(
      (name) => name.startsWith('.client-') || name === '.backup.lock',
    ),
  );
  console.info(
    JSON.stringify({
      event: 'backup_acceptance_passed',
      mysql: '8.0.46',
      client: '8.0.46',
      tables: manifest.tables.length,
      migrations: manifest.migrations.length,
      bytes: manifest.bytes,
      elapsedMs,
      independentCopy: true,
      unicodePreserved: true,
      constraintsPreserved: true,
      quotaPreserved: true,
      existingTargetRefused: true,
      tamperRefusedBeforeCreate: true,
      compiledApiReady: true,
      productionWrites: false,
      unsupportedObjectsRefused: true,
      migrationLockContention: true,
      backupLockContention: true,
      lostLockChildStopped: true,
      lockLossMs,
      repeatedCompiledMigration: true,
    }),
  );
} catch (error) {
  if (work)
    await writeFile(
      join(work, 'failure.txt'),
      String(error instanceof Error ? error.stack : error),
      { mode: 0o600 },
    );
  console.error(JSON.stringify({ event: 'backup_acceptance_failed', privateDiagnostic: !!work }));
  process.exitCode = 1;
} finally {
  maintenanceController.abort();
  await maintenance;
  if (api && api.exitCode === null && api.signalCode === null) {
    api.kill('SIGTERM');
    const timer = setTimeout(() => api?.kill('SIGKILL'), 5000).unref();
    await apiExited;
    clearTimeout(timer);
  }
  const cleaned = await Promise.allSettled(
    [...(restoreOwned ? [restoreName] : []), ...(sourceCreated ? [source] : [])].map(
      async (name) => {
        assert(/^ha_radio_test_(backup|restore)_[a-z0-9_]+$/.test(name));
        await admin!.query('DROP DATABASE `' + name + '`');
        const [rows] = await admin!.execute<RowDataPacket[]>(
          'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',
          [name],
        );
        assert.equal(rows.length, 0);
      },
    ),
  );
  await admin?.end();
  if (cleaned.some((item) => item.status === 'rejected')) {
    process.exitCode = 1;
    console.error(JSON.stringify({ event: 'backup_test_cleanup_failed' }));
  }
  if (work && process.exitCode !== 1) await rm(work, { recursive: true, force: true });
  console.info(
    JSON.stringify({
      event: 'backup_test_cleanup',
      sourceRemoved: sourceCreated,
      restoreRemoved: restoreOwned,
      ownedApiStopped: !api || api.exitCode !== null || api.signalCode !== null,
    }),
  );
}
