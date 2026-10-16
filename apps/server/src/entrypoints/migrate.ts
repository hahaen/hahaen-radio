import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readDatabaseConfig } from '../config/database.js';
import { openDatabase } from '../db/connection.js';

try {
  const config = readDatabaseConfig();
  const database = await openDatabase(config);
  await database.close();
  const cwd = fileURLToPath(new URL('../../', import.meta.url));
  const child = spawn(
    process.execPath,
    ['node_modules/drizzle-kit/bin.cjs', 'migrate', '--config=drizzle.config.ts'],
    { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  // Kit/driver errors can include connection details or SQL; emit a bounded status only.
  child.stdout.resume();
  child.stderr.resume();
  const timer = setTimeout(() => child.kill('SIGTERM'), 120000);
  const forward = () => child.kill('SIGTERM');
  process.once('SIGTERM', forward);
  process.once('SIGINT', forward);
  const status = await new Promise<number>((resolve) => {
    child.once('error', () => resolve(1));
    child.once('close', (code) => resolve(code ?? 1));
  });
  clearTimeout(timer);
  process.removeListener('SIGTERM', forward);
  process.removeListener('SIGINT', forward);
  if (status !== 0) throw new Error('MIGRATION_FAILED');
  console.info(JSON.stringify({ event: 'migration_completed' }));
} catch {
  console.error(
    JSON.stringify({
      event: 'migration_failed',
      instruction: 'Inspect target structure and migration history before retrying',
    }),
  );
  process.exitCode = 1;
}
