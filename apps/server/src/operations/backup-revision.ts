import { lstat, readFile, open, rename, unlink } from 'node:fs/promises';
import { isAbsolute, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
const pattern = /^[a-f0-9]{40}$/;
async function checkedPath(path: string | undefined) {
  if (!path || !isAbsolute(path)) throw Error('Invalid revision state path');
  const parent = await lstat(dirname(path));
  if (
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    parent.uid !== process.getuid?.() ||
    (parent.mode & 0o777) !== 0o700
  )
    throw Error('Invalid revision state directory');
  return path;
}
export async function readBackupRevision(env: NodeJS.ProcessEnv) {
  if (!env.BACKUP_APPLICATION_REVISION_PATH) {
    if (!pattern.test(env.BACKUP_APPLICATION_REVISION ?? ''))
      throw Error('Missing backup revision');
    return env.BACKUP_APPLICATION_REVISION!;
  }
  const path = await checkedPath(env.BACKUP_APPLICATION_REVISION_PATH),
    stat = await lstat(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o777) !== 0o600 ||
    stat.size !== 41
  )
    throw Error('Invalid revision state');
  const value = (await readFile(path, 'utf8')).trim();
  if (!pattern.test(value)) throw Error('Invalid backup revision');
  return value;
}
export async function recordBackupRevision(path: string | undefined, revision: string) {
  if (!pattern.test(revision)) throw Error('Invalid backup revision');
  const target = await checkedPath(path),
    pending = target + '.pending-' + randomBytes(6).toString('hex');
  const handle = await open(pending, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(revision + '\n');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(pending, target);
    const parent = await open(dirname(target), 'r');
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
  } finally {
    await unlink(pending).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}
