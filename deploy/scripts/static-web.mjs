import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
} from 'node:fs/promises';
import { join } from 'node:path';
import { imageIdentity } from './release/images.mjs';
import { load, save } from './release/common.mjs';

async function digestTree(directory, normalize = false) {
  const root = await lstat(directory);
  assert(root.isDirectory() && !root.isSymbolicLink());
  if (normalize) await chmod(directory, 0o755);
  else assert.equal(root.mode & 0o777, 0o755);
  const hash = createHash('sha256');
  let bytes = 0,
    count = 0;
  async function visit(path, prefix = '') {
    const entries = (await readdir(path)).sort();
    for (const name of entries) {
      assert(/^[A-Za-z0-9_.-]+$/.test(name));
      const file = join(path, name),
        relative = prefix + name,
        stat = await lstat(file);
      assert(!stat.isSymbolicLink());
      assert(++count <= 10000);
      if (stat.isDirectory()) {
        if (normalize) await chmod(file, 0o755);
        else assert.equal(stat.mode & 0o777, 0o755);
        await visit(file, relative + '/');
      } else {
        assert(stat.isFile() && stat.nlink === 1 && stat.size <= 100 * 1024 * 1024);
        bytes += stat.size;
        assert(bytes <= 256 * 1024 * 1024);
        if (normalize) await chmod(file, 0o644);
        else assert.equal(stat.mode & 0o777, 0o644);
        hash
          .update(relative + '\0' + String(stat.size) + '\0')
          .update(await readFile(file))
          .update('\0');
      }
    }
  }
  await visit(directory);
  assert((await lstat(join(directory, 'index.html'))).isFile());
  return hash.digest('hex');
}
function identity(value, id) {
  return { format: 1, image: value.images.web, revision: value.imageRevisions.web, imageId: id };
}
async function validateRelease(directory, expected) {
  const stat = await lstat(directory);
  assert(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid());
  const receipt = await load(join(directory, 'receipt.json'));
  assert.deepEqual({ ...receipt, filesSha256: undefined }, { ...expected, filesSha256: undefined });
  assert.equal(await digestTree(join(directory, 'site')), receipt.filesSha256);
  return receipt;
}
export async function prepareStaticWeb(run, value, config, cleanup = run) {
  const image = await imageIdentity(
    run,
    value.images.web,
    value.imageRevisions.web,
    value.platform,
  );
  const expected = identity(value, image.Id),
    key = image.Id.slice('sha256:'.length);
  const releases = join(config.staticDirectory, 'releases'),
    directory = join(releases, key);
  await mkdir(releases, { recursive: true, mode: 0o755 });
  await chmod(releases, 0o755);
  try {
    await lstat(directory);
    return await validateRelease(directory, expected);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const stage = join(releases, '.incoming-' + randomBytes(12).toString('hex'));
  await mkdir(stage, { mode: 0o755 });
  await chmod(stage, 0o755);
  const site = join(stage, 'site');
  await mkdir(site, { mode: 0o755 });
  await chmod(site, 0o755);
  let container;
  try {
    container = await run([
      'create',
      '--tmpfs',
      '/data',
      '--tmpfs',
      '/config',
      '--name',
      'radio-static-' + randomBytes(12).toString('hex'),
      value.images.web,
    ]);
    assert(/^[a-f0-9]{64}$/.test(container));
    await run(['cp', container + ':/srv/.', site]);
    const receipt = { ...expected, filesSha256: await digestTree(site, true) };
    await save(join(stage, 'receipt.json'), receipt);
    await rename(stage, directory);
    return receipt;
  } finally {
    // This container only exposes the immutable public artifact and is never started.
    try {
      if (container) await cleanup(['rm', '--volumes', container]);
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  }
}
export async function assertStaticWeb(value, config) {
  const current = await readlink(join(config.staticDirectory, 'current'));
  assert(/^releases\/[a-f0-9]{64}\/site$/.test(current));
  const imageId = 'sha256:' + current.split('/')[1];
  return validateRelease(
    join(config.staticDirectory, 'releases', current.split('/')[1]),
    identity(value, imageId),
  );
}
export async function activateStaticWeb(run, value, config, cleanup = run) {
  const receipt = await prepareStaticWeb(run, value, config, cleanup);
  const pending = join(config.staticDirectory, '.current-' + randomBytes(12).toString('hex'));
  try {
    await symlink('releases/' + receipt.imageId.slice(7) + '/site', pending);
    await rename(pending, join(config.staticDirectory, 'current'));
    await assertStaticWeb(value, config);
  } finally {
    await rm(pending, { force: true });
  }
}
