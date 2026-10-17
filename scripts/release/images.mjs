import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  command,
  roles,
  revisionPattern,
  registryFor,
  platform,
  validateBuild,
  localEngine,
  imageReference,
  idPattern,
} from './common.mjs';

export async function sourceMigrations() {
  const journal = JSON.parse(await readFile('migrations/meta/_journal.json', 'utf8'));
  assert(
    Array.isArray(journal.entries) && journal.entries.length > 0 && journal.entries.length < 1000,
  );
  const result = [];
  for (const entry of journal.entries) {
    assert(/^\d{4}_[a-z0-9_]+$/.test(entry.tag));
    const file = entry.tag + '.sql';
    result.push({
      file,
      sha256: createHash('sha256')
        .update(await readFile(join('migrations', file)))
        .digest('hex'),
    });
  }
  assert.equal(new Set(result.map((item) => item.file)).size, result.length);
  return result;
}
export async function currentSource(revision) {
  assert(revisionPattern.test(revision));
  assert.equal(await command('git', ['rev-parse', 'HEAD']), revision);
  assert.equal(await command('git', ['status', '--porcelain']), '');
}
export async function imageIdentity(run, reference, expectedRevision, expectedPlatform) {
  const image = JSON.parse(await run(['image', 'inspect', reference]));
  assert.equal(image.length, 1);
  const [value] = image;
  assert(idPattern.test(value.Id));
  assert.equal(value.Config.Labels['org.opencontainers.image.revision'], expectedRevision);
  assert.equal(`${value.Os}/${value.Architecture}`, expectedPlatform);
  return value;
}
export async function buildImages(run, revision, repository, targetPlatform, signal) {
  registryFor(repository);
  platform(targetPlatform);
  await currentSource(revision);
  assert.equal(await localEngine(run), targetPlatform);
  const nonce = randomBytes(6).toString('hex');
  const images = {};
  for (const role of roles) {
    const tag = `${repository}/${role}:${revision}-${nonce}`;
    await run(
      [
        'build',
        '--pull',
        '--platform',
        targetPlatform,
        '--file',
        'deploy/docker/Dockerfile',
        '--target',
        role,
        '--build-arg',
        'VCS_REF=' + revision,
        '--tag',
        tag,
        '.',
      ],
      { capture: false, timeout: 1800000, signal },
    );
    const image = await imageIdentity(run, tag, revision, targetPlatform);
    images[role] = { id: image.Id, tag };
  }
  await currentSource(revision);
  return validateBuild({
    format: 1,
    revision,
    repository,
    platform: targetPlatform,
    run: nonce,
    images,
    migrations: await sourceMigrations(),
  });
}
export async function assertImages(run, build) {
  validateBuild(build);
  assert.equal(await localEngine(run), build.platform);
  for (const role of roles)
    assert.equal(
      (await imageIdentity(run, build.images[role].tag, build.revision, build.platform)).Id,
      build.images[role].id,
    );
}
export function validateImageCheck(check, build) {
  assert.equal(check?.format, 1);
  assert.equal(check?.revision, build.revision);
  assert.equal(check?.run, build.run);
  assert.equal(check?.mysql, '8.0.46');
  assert.equal(check?.migrations, build.migrations.length);
  assert(Number.isSafeInteger(check?.tables) && check.tables > 1);
  assert.deepEqual(
    check?.images,
    Object.fromEntries(roles.map((role) => [role, build.images[role].id])),
  );
  for (const field of [
    'migration',
    'repeatedMigration',
    'api',
    'jobs',
    'web',
    'staticAsset',
    'cleanup',
  ])
    assert.equal(check.checks?.[field], true);
  return check;
}
export async function publishImages(run, build, check) {
  validateImageCheck(check, build);
  await currentSource(build.revision);
  await assertImages(run, build);
  assert.deepEqual(await sourceMigrations(), build.migrations);
  const images = {};
  for (const role of roles) {
    const { tag, id } = build.images[role];
    await run(['push', tag], { capture: false, timeout: 900000 });
    const current = await imageIdentity(run, tag, build.revision, build.platform);
    assert.equal(current.Id, id);
    const repository = `${build.repository}/${role}`;
    const matches = (current.RepoDigests ?? []).filter((value) =>
      value.startsWith(repository + '@'),
    );
    assert.equal(matches.length, 1);
    let reference = imageReference(matches[0]);
    // Resolve the native-platform manifest even when the registry returns an OCI index.
    let remote = JSON.parse(await run(['buildx', 'imagetools', 'inspect', '--raw', reference]));
    if (Array.isArray(remote.manifests)) {
      const candidates = remote.manifests.filter(
        (item) => `${item.platform?.os}/${item.platform?.architecture}` === build.platform,
      );
      assert.equal(candidates.length, 1);
      reference = imageReference(repository + '@' + candidates[0].digest);
      remote = JSON.parse(await run(['buildx', 'imagetools', 'inspect', '--raw', reference]));
    }
    assert.equal(remote.config?.digest, id);
    images[role] = reference;
  }
  return {
    format: 1,
    revision: build.revision,
    platform: build.platform,
    images,
    migrations: build.migrations,
    imageCheckRun: check.run,
  };
}
export async function registryConfiguration(source, directory, repository) {
  const host = registryFor(repository);
  const stat = await lstat(source);
  assert(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.nlink === 1 &&
      [0o400, 0o600].includes(stat.mode & 0o777) &&
      stat.size <= 65536,
  );
  assert(!process.getuid || stat.uid === process.getuid());
  const value = JSON.parse(await readFile(source, 'utf8'));
  assert.deepEqual(Object.keys(value), ['auths']);
  assert.deepEqual(Object.keys(value.auths), [host]);
  assert.deepEqual(Object.keys(value.auths[host]), ['auth']);
  assert(/^[A-Za-z0-9+/]{8,16384}={0,2}$/.test(value.auths[host].auth));
  const target = await mkdtemp(join(directory, '.registry-'));
  try {
    await writeFile(join(target, 'config.json'), JSON.stringify(value), {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
  return target;
}
