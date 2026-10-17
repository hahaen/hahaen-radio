import { databaseTargetFingerprint } from '../config/database.js';
import { it, expect } from 'vitest';
import { mkdtemp, rm, chmod, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordBackupRevision, readBackupRevision } from './backup-revision.js';
it('uses the durably recorded running server revision ahead of an outdated environment value', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haen-revision-')),
    path = join(root, 'revision');
  try {
    await recordBackupRevision(path, 'a'.repeat(40));
    await recordBackupRevision(path, 'b'.repeat(40));
    expect(
      await readBackupRevision({
        BACKUP_APPLICATION_REVISION_PATH: path,
        BACKUP_APPLICATION_REVISION: 'a'.repeat(40),
      }),
    ).toBe('b'.repeat(40));
    expect(await readFile(path, 'utf8')).toBe('b'.repeat(40) + '\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('refuses missing configured state, permissive files, symlinks and unsafe revision directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haen-revision-')),
    path = join(root, 'revision');
  try {
    const env = {
      BACKUP_APPLICATION_REVISION_PATH: path,
      BACKUP_APPLICATION_REVISION: 'a'.repeat(40),
    };
    await expect(readBackupRevision(env)).rejects.toThrow();
    await recordBackupRevision(path, 'a'.repeat(40));
    await chmod(path, 0o644);
    await expect(readBackupRevision(env)).rejects.toThrow();
    await symlink(path, join(root, 'link'));
    await expect(
      readBackupRevision({ ...env, BACKUP_APPLICATION_REVISION_PATH: join(root, 'link') }),
    ).rejects.toThrow();
    await chmod(root, 0o755);
    await expect(recordBackupRevision(path, 'b'.repeat(40))).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('binds backup target to host, port, database and TLS CA while allowing separate role credentials', () => {
  const config = {
    host: 'db.example.test',
    port: 3306,
    database: 'ha_radio',
    user: 'fixture',
    password: 'fixture',
    connectionLimit: 1,
    ssl: { rejectUnauthorized: true, verifyIdentity: true, ca: 'public-ca' },
  };
  const hash = databaseTargetFingerprint(config);
  expect(
    databaseTargetFingerprint({ ...config, user: 'other-fixture', password: 'other-fixture' }),
  ).toBe(hash);
  for (const changed of [
    { ...config, host: 'other.example.test' },
    { ...config, port: 3307 },
    { ...config, database: 'ha_radio_dev' },
    { ...config, ssl: { ...config.ssl, ca: 'other-ca' } },
  ])
    expect(databaseTargetFingerprint(changed)).not.toBe(hash);
});
