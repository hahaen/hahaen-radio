import { afterEach, expect, it } from 'vitest';
import { mkdtemp, chmod, mkdir, writeFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import {
  optionValue,
  createBackup,
  pruneBackups,
  verifyBackup,
  restoreIsolated,
  validateBackupGrants,
} from './backup.js';
import type { DatabaseConfig } from '../config/database.js';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function base() {
  const root = await mkdtemp(join(tmpdir(), 'haen-backup-unit-'));
  roots.push(root);
  await chmod(root, 0o700);
  return root;
}
async function fixture(root: string, index: number, kind = 'daily') {
  const date = new Date(Date.UTC(2026, 9, 1, 0, 0, index)).toISOString();
  const id =
    'haen-' +
    date.replaceAll('-', '').replaceAll(':', '').replace('.', '') +
    '-' +
    String(index).padStart(12, '0');
  const directory = join(root, id);
  await mkdir(directory, { mode: 0o700 });
  const plain = Buffer.from('CREATE TABLE fixture (id int);\n'),
    dump = gzipSync(plain);
  const manifest = {
    format: 1,
    id,
    kind,
    createdAt: date,
    sourceDatabase: 'ha_radio_dev',
    serverVersion: '8.0.46',
    revision: 'a'.repeat(40),
    tables: ['fixture'],
    migrations: [{ hash: 'b'.repeat(64), createdAt: '1' }],
    counts: kind === 'pre-migration' ? { fixture: '0' } : null,
    bytes: dump.length,
    plainBytes: plain.length,
    sha256: createHash('sha256').update(dump).digest('hex'),
  };
  await writeFile(join(directory, 'dump.sql.gz'), dump, { mode: 0o600 });
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 });
  return id;
}
it('quotes special option-file values without creating another client option', () => {
  expect(optionValue('a"\\\n\r\t#password')).toBe('"a\\"\\\\\\n\\r\\t#password"');
  expect(() => optionValue('nul\0value')).toThrow();
});
it('verifies full gzip contents and rejects tampered data or a mismatched receipt directory', async () => {
  const directory = await base(),
    id = await fixture(directory, 1);
  expect((await verifyBackup({ directory }, id)).plainBytes).toBeGreaterThan(0);
  await writeFile(join(directory, id, 'dump.sql.gz'), 'corrupted', { mode: 0o600 });
  await expect(verifyBackup({ directory }, id)).rejects.toThrow();
  expect((await readdir(directory)).includes('.backup.lock')).toBe(false);
});
it('refuses loose permissions, symlinked artifacts and another running maintenance lock', async () => {
  const directory = await base(),
    id = await fixture(directory, 1),
    meta = join(directory, id, 'manifest.json');
  await chmod(meta, 0o644);
  await expect(verifyBackup({ directory }, id)).rejects.toThrow();
  await chmod(meta, 0o600);
  await rm(meta);
  await symlink(join(directory, 'other'), meta);
  await expect(verifyBackup({ directory }, id)).rejects.toThrow();
  await writeFile(join(directory, '.backup.lock'), 'owned by another operation', { mode: 0o600 });
  await expect(pruneBackups({ directory })).rejects.toThrow();
  expect(await readdir(directory)).toContain('.backup.lock');
});
it('retains seven daily and three pre-migration complete backups and leaves unrelated files intact', async () => {
  const directory = await base();
  for (let n = 0; n < 9; n++) await fixture(directory, n);
  for (let n = 10; n < 15; n++) await fixture(directory, n, 'pre-migration');
  await writeFile(join(directory, 'operator-note'), 'retain', { mode: 0o600 });
  expect(await pruneBackups({ directory })).toBe(4);
  expect(await pruneBackups({ directory })).toBe(0);
  expect(await readdir(directory)).toHaveLength(11);
});
it('refuses production or existing-role targets before opening a backup or database', async () => {
  const config: DatabaseConfig = {
    database: 'ha_radio',
    host: '127.0.0.1',
    port: 3306,
    user: 'fixture',
    password: 'fixture',
    connectionLimit: 1,
    ssl: undefined,
  };
  await expect(
    restoreIsolated({ directory: '/nonexistent', dumpPath: '', mysqlPath: '' }, config, 'invalid'),
  ).rejects.toThrow();
});

it('requires complete source metadata visibility and scoped backup privileges instead of silently omitting objects', () => {
  const db = 'ha_radio_test_backup_unit';
  const scope =
    'GRANT SELECT, SHOW VIEW, TRIGGER, EVENT ON `' + db + "`.* TO 'fixture'@'localhost'";
  expect(() => validateBackupGrants([scope], db)).toThrow();
  expect(() =>
    validateBackupGrants([scope, "GRANT SHOW_ROUTINE ON *.* TO 'fixture'@'localhost'"], db),
  ).not.toThrow();
  expect(() =>
    validateBackupGrants(
      [scope.replace('TRIGGER, ', ''), "GRANT SHOW_ROUTINE ON *.* TO 'fixture'@'localhost'"],
      db,
    ),
  ).toThrow();
  expect(() =>
    validateBackupGrants(
      [scope.replace(db, 'another_schema'), "GRANT SHOW_ROUTINE ON *.* TO 'fixture'@'localhost'"],
      db,
    ),
  ).toThrow();
});

it('fails a missing external client without leaving a lock, credentials, artifacts or an unhandled spawn error', async () => {
  const directory = await base();
  const config: DatabaseConfig = {
    database: 'ha_radio_dev',
    host: '127.0.0.1',
    port: 3306,
    user: 'fixture',
    password: 'fixture',
    connectionLimit: 1,
    ssl: undefined,
  };
  await expect(
    createBackup(
      { directory, dumpPath: join(directory, 'missing-mysqldump'), mysqlPath: '' },
      config,
      'daily',
      'a'.repeat(40),
      true,
      false,
    ),
  ).rejects.toThrow();
  expect(await readdir(directory)).toEqual([]);
});

it('honors a cancelled verification and releases its lock without changing the backup', async () => {
  const directory = await base(),
    id = await fixture(directory, 1);
  await expect(verifyBackup({ directory, signal: AbortSignal.abort() }, id)).rejects.toThrow();
  expect(await readdir(directory)).toEqual([id]);
  expect((await verifyBackup({ directory }, id)).id).toBe(id);
});
