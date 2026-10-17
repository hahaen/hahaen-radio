import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import type { DatabaseConfig } from '../config/database.js';

export class MaintenanceError extends Error {
  constructor() {
    super('Database maintenance refused or interrupted');
  }
}
export function maintenanceKey(database: string) {
  if (!/^(ha_radio|ha_radio_dev|ha_radio_test_[a-z0-9_]{1,40})$/.test(database))
    throw new MaintenanceError();
  return 'haen:maintenance:' + createHash('sha256').update(database).digest('hex').slice(0, 40);
}

export function releaseKey(database: string) {
  return maintenanceKey(database).replace('haen:maintenance:', 'haen:release:');
}
export function withMaintenanceLock<T>(
  config: DatabaseConfig,
  operation: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
) {
  return withNamedLock(config, maintenanceKey(config.database), operation, signal);
}
export function withReleaseLock<T>(
  config: DatabaseConfig,
  operation: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
) {
  return withNamedLock(config, releaseKey(config.database), operation, signal);
}

/** Cooperative instance-wide lock; callers must await cancellation before returning. */
async function withNamedLock<T>(
  config: DatabaseConfig,
  key: string,
  operation: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  if (
    (!config.ssl &&
      (!['localhost', '127.0.0.1', '::1'].includes(config.host) ||
        config.database === 'ha_radio')) ||
    (config.ssl && (!config.ssl.rejectUnauthorized || !config.ssl.verifyIdentity))
  )
    throw new MaintenanceError();
  const { ssl } = config;
  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    charset: 'utf8mb4_general_ci',
    timezone: 'Z',
    connectTimeout: 8000,
    ...(ssl ? { ssl } : {}),
  });
  const controller = new AbortController();
  const active = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]);
  const lost = () => controller.abort(new MaintenanceError());
  connection.on('error', lost);
  let held = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let checking: Promise<void> | undefined;
  const query = async (sql: string, values: string[] = []) => {
    const [rows] = await connection.query<RowDataPacket[]>({ sql, values, timeout: 3000 });
    return rows;
  };
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    active.throwIfAborted();
    await query("SET time_zone = '+00:00'");
    const [baseline] = await query(
      'SELECT VERSION() AS version, @@collation_connection AS collation, @@session.time_zone AS zone',
    );
    if (
      typeof baseline?.version !== 'string' ||
      baseline.version.split('-')[0] !== '8.0.46' ||
      baseline.collation !== 'utf8mb4_general_ci' ||
      baseline.zone !== '+00:00'
    )
      throw new MaintenanceError();
    const [locked] = await query('SELECT GET_LOCK(?, 0) AS owned', [key]);
    if (locked?.owned !== 1) throw new MaintenanceError();
    held = true;
    active.throwIfAborted();
    const check = async () => {
      const [row] = await query('SELECT IS_USED_LOCK(?) = CONNECTION_ID() AS owned', [key]);
      if (row?.owned !== 1) throw new MaintenanceError();
    };
    timer = setInterval(() => {
      if (checking || active.aborted) return;
      checking = check()
        .catch(lost)
        .finally(() => {
          checking = undefined;
        });
    }, 1000).unref();
    const result = await operation(active);
    await checking;
    active.throwIfAborted();
    await check();
    outcome = { ok: true, value: result };
  } catch (error) {
    outcome = { ok: false, error };
  } finally {
    if (timer) clearInterval(timer);
    await checking;
    try {
      if (held) {
        const [released] = await query('SELECT RELEASE_LOCK(?) AS released', [key]);
        if (released?.released !== 1 && outcome!.ok)
          outcome = { ok: false, error: new MaintenanceError() };
      }
    } catch (error) {
      if (outcome!.ok) outcome = { ok: false, error };
    } finally {
      // End the owning session even when RELEASE_LOCK fails. No automatic reconnect.
      connection.destroy();
    }
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

/** No shell or raw child output. Cancellation waits for actual close before returning. */
export async function runMaintenanceClient(
  executable: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  timeoutMs = 120000,
) {
  signal.throwIfAborted();
  const active = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  const child = spawn(executable, args, { cwd, env, stdio: 'ignore', signal: active });
  const closed = new Promise<number | null>((resolve) => child.once('close', resolve));
  const failed = new Promise<never>((_resolve, reject) =>
    child.once('error', () => reject(new MaintenanceError())),
  );
  try {
    if ((await Promise.race([closed, failed])) !== 0) throw new MaintenanceError();
    active.throwIfAborted();
  } catch {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000).unref();
    await closed;
    clearTimeout(timer);
    throw new MaintenanceError();
  }
}
