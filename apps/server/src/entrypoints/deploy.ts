import { spawn } from 'node:child_process';
import { fstatSync, lstatSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readDatabaseConfig, databaseTargetFingerprint } from '../config/database.js';
import { withReleaseLock } from '../operations/maintenance.js';

const lockPath = '/var/lib/haen-maintenance/deploy.lock';
const controller = new AbortController();
const cancel = () => controller.abort();
process.once('SIGTERM', cancel);
process.once('SIGINT', cancel);
try {
  if (process.platform !== 'linux' || process.version !== 'v24.9.0')
    throw Error('Unsupported target');
  const lock = lstatSync(lockPath),
    parent = lstatSync('/var/lib/haen-maintenance');
  if (
    !lock.isFile() ||
    lock.isSymbolicLink() ||
    lock.nlink !== 1 ||
    lock.uid !== 0 ||
    (lock.mode & 0o777) !== 0o660 ||
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    parent.uid !== 0 ||
    (parent.mode & 0o777) !== 0o750
  )
    throw Error('Invalid host lock');
  if (process.argv.length === 2) {
    const child = spawn(
      '/usr/bin/flock',
      [
        '--no-fork',
        '--exclusive',
        '--nonblock',
        '--conflict-exit-code',
        '75',
        lockPath,
        process.execPath,
        ...process.execArgv,
        process.argv[1]!,
        '--locked',
      ],
      { stdio: 'inherit' },
    );
    const forward = () => {
      child.kill('SIGTERM');
    };
    controller.signal.addEventListener('abort', forward, { once: true });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    controller.signal.removeEventListener('abort', forward);
    if (code !== 0) throw Error('Deployment refused');
  } else if (process.argv.length === 3 && process.argv[2] === '--locked') {
    const fd = fstatSync(3);
    if (
      fd.dev !== lock.dev ||
      fd.ino !== lock.ino ||
      !readFileSync('/proc/locks', 'utf8')
        .split('\n')
        .some((line) => {
          const values = line.trim().split(/\s+/);
          return (
            values[1] === 'FLOCK' &&
            values[3] === 'WRITE' &&
            Number(values[4]) === process.pid &&
            values[5]?.split(':').at(-1) === String(lock.ino)
          );
        })
    )
      throw Error('Host release lock not held');
    const config = readDatabaseConfig();
    const script = new URL('../../../../scripts/deploy/target.mjs', import.meta.url);
    const module = (await import(script.href)) as {
      executeTarget: (
        env: NodeJS.ProcessEnv,
        signal: AbortSignal,
        database: typeof config,
        targetFingerprint: string,
      ) => Promise<unknown>;
    };
    process.chdir(fileURLToPath(new URL('../../../../', import.meta.url)));
    // A locked target runs from the complete, checked-out source tree, never an API image.
    if (!fileURLToPath(script).endsWith('/scripts/deploy/target.mjs'))
      throw Error('Invalid operations tree');
    const result = await withReleaseLock(
      config,
      (active) =>
        module.executeTarget(process.env, active, config, databaseTargetFingerprint(config)),
      controller.signal,
    );
    console.info(JSON.stringify({ event: 'target_release_completed', ...(result as object) }));
  } else throw Error('Invalid arguments');
} catch {
  console.error(
    JSON.stringify({
      event: 'target_release_failed',
      instruction:
        'Inspect durable target state, host lock, maintenance and stopped writers; never retry a failed migration automatically',
    }),
  );
  process.exitCode = 1;
} finally {
  process.removeListener('SIGTERM', cancel);
  process.removeListener('SIGINT', cancel);
}
