import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, chmod, readdir, realpath } from 'node:fs/promises';
import { join, resolve, isAbsolute } from 'node:path';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
import {
  outputDirectory,
  load,
  save,
  revisionPattern,
  roles,
  platform,
  validateBuild,
} from './common.mjs';
import { currentSource, sourceMigrations, validateImageCheck } from './images.mjs';
import { validateRelease } from '../flow.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digestPattern = /^[a-f0-9]{64}$/;
export function deploymentContext(env) {
  assert(env.CI === 'true' && revisionPattern.test(env.HAEN_SOURCE_COMMIT));
  assert(/^[a-z][a-z0-9-]{1,39}$/.test(env.HAEN_TARGET_NAME));
  assert(
    /^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?:\/[a-z0-9-]+)*$/.test(env.HAEN_TARGET_SITE),
  );
  assert(digestPattern.test(env.HAEN_TARGET_DATABASE_FINGERPRINT));
  assert(['full', 'web', 'server'].includes(env.HAEN_DEPLOY_SCOPE));
  return {
    revision: env.HAEN_SOURCE_COMMIT,
    platform: platform(env.HAEN_RELEASE_PLATFORM),
    target: env.HAEN_TARGET_NAME,
    site: env.HAEN_TARGET_SITE,
    databaseFingerprint: env.HAEN_TARGET_DATABASE_FINGERPRINT,
    scope: env.HAEN_DEPLOY_SCOPE,
  };
}
function releaseMetadata(value) {
  validateRelease(value);
  assert.deepEqual(
    Object.keys(value).sort(),
    ['format', 'revision', 'platform', 'images', 'migrations', 'imageCheckRun'].sort(),
  );
  assert.deepEqual(Object.keys(value.images).sort(), [...roles].sort());
  for (const item of value.migrations)
    assert.deepEqual(Object.keys(item).sort(), ['file', 'sha256']);
  return value;
}
export async function checkedDeployEnvironment(path, previousWorkspace) {
  assert(
    typeof path === 'string' &&
      isAbsolute(path) &&
      resolve(path) === path &&
      !path.startsWith(resolve('.') + '/'),
  );
  const actual = await realpath(path);
  for (const root of [resolve('.'), previousWorkspace].filter(Boolean)) {
    const existing = await realpath(root).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    if (existing) assert(!actual.startsWith(existing + '/'));
  }
  const stat = await lstat(path);
  assert(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.nlink === 1 &&
      stat.uid === process.getuid() &&
      (stat.mode & 0o777) === 0o600 &&
      stat.size <= 65536,
  );
  const values = parseEnv(await readFile(path, 'utf8'));
  assert(values.NODE_ENV === 'production');
  assert(
    !Object.keys(values).some(
      (key) => key !== 'NODE_ENV' && /^(NODE_|NPM_|PNPM_|LD_|DYLD_|DOCKER_|COMPOSE_)/.test(key),
    ),
  );
}
export async function handoff(stage, env) {
  assert.equal(process.version, 'v24.22.1');
  const directory = await outputDirectory();
  if (stage === 'prepare-target') {
    assert(env.CI === 'true');
    await currentSource(env.HAEN_SOURCE_COMMIT);
    assert.deepEqual(await readdir(directory), []);
    return undefined;
  }
  const context = deploymentContext(env);
  await currentSource(context.revision);
  const path = join(directory, 'deploy-handoff.json');
  if (stage === 'seal') {
    const build = validateBuild(await load(join(directory, 'build.json')));
    assert.equal(build.revision, context.revision);
    assert.equal(build.platform, context.platform);
    const check = validateImageCheck(await load(join(directory, 'image-check.json')), build);
    const release = releaseMetadata(await load(join(directory, 'release.json')));
    assert.equal(release.revision, context.revision);
    assert.equal(release.platform, context.platform);
    assert.equal(release.imageCheckRun, check.run);
    assert.deepEqual(release.migrations, build.migrations);
    for (const role of roles)
      assert.equal(release.images[role].split('@')[0], build.repository + '/' + role);
    assert.deepEqual(release.migrations, await sourceMigrations());
    await save(path, { format: 1, ...context, release });
    return hash(await readFile(path));
  }
  assert(stage === 'accept' && digestPattern.test(env.HAEN_APPROVED_HANDOFF_SHA256));
  const stat = await lstat(path);
  assert(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.nlink === 1 &&
      stat.uid === process.getuid() &&
      [0o600, 0o644].includes(stat.mode & 0o777) &&
      stat.size < 1024 * 1024,
  );
  const bytes = await readFile(path);
  assert.equal(hash(bytes), env.HAEN_APPROVED_HANDOFF_SHA256);
  const value = JSON.parse(bytes.toString('utf8'));
  assert.deepEqual(
    Object.keys(value).sort(),
    ['format', ...Object.keys(context), 'release'].sort(),
  );
  assert.equal(value.format, 1);
  for (const [key, expected] of Object.entries(context)) assert.equal(value[key], expected);
  const release = releaseMetadata(value.release);
  assert.equal(release.revision, context.revision);
  assert.equal(release.platform, context.platform);
  assert.deepEqual(release.migrations, await sourceMigrations());
  await checkedDeployEnvironment(env.HAEN_DEPLOY_ENV_FILE, env.HAEN_JENKINS_WORKSPACE_ROOT);
  await chmod(path, 0o600);
  const target = join(directory, 'target-release.json');
  await save(target, release);
  return hash(await readFile(target));
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const result = await handoff(process.argv[2], process.env);
    if (result) console.info(result);
  } catch {
    console.error(
      JSON.stringify({
        event: 'deployment_handoff_failed',
        instruction:
          'Verify source, approval digest, target identity and private environment; no target release was started',
      }),
    );
    process.exitCode = 1;
  }
}
