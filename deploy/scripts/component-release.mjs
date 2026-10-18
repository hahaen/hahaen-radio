import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { chmod, lstat, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { docker, outputDirectory, load, save, platform, localEngine } from './release/common.mjs';
import { currentSource, sourceMigrations, imageIdentity } from './release/images.mjs';
import { componentRelease, components, webRelease } from './component-state.mjs';
import { prepareStaticWeb } from './static-web.mjs';
import { engineIdentity, localImage } from './local-images.mjs';
import { checkedDeployEnvironment } from './release/handoff.mjs';
const sha = (value) => createHash('sha256').update(value).digest('hex');
export async function sourceDescriptor(env) {
  assert(components.includes(env.HAEN_DEPLOY_SCOPE));
  await currentSource(env.HAEN_SOURCE_COMMIT);
  const hash = createHash('sha256');
  async function visit(directory, prefix = '') {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const name = prefix + entry.name;
      assert(!entry.isSymbolicLink());
      if (entry.isDirectory()) await visit(join(directory, entry.name), name + '/');
      else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.includes('.test.')) {
        const bytes = await readFile(join(directory, entry.name));
        hash.update(JSON.stringify([name, bytes.length]) + '\n').update(bytes);
      }
    }
  }
  await visit('packages/contracts/src');
  const policy = JSON.parse(await readFile('deploy/compatibility/policy.json', 'utf8'));
  assert(policy.format === 1);
  for (const key of ['compatibleContracts', 'compatibleSchemas'])
    assert(
      Array.isArray(policy[key]) &&
        policy[key].length <= 100 &&
        policy[key].every((value) => /^[a-f0-9]{64}$/.test(value)),
    );
  return {
    format: 2,
    component: env.HAEN_DEPLOY_SCOPE,
    revision: env.HAEN_SOURCE_COMMIT,
    platform: platform(env.HAEN_RELEASE_PLATFORM),
    contractHash: hash.digest('hex'),
    migrations: await sourceMigrations(),
    compatibleContracts: policy.compatibleContracts,
    compatibleSchemas: policy.compatibleSchemas,
  };
}
function context(env) {
  assert(env.CI === 'true' && /^[a-z][a-z0-9-]{1,39}$/.test(env.HAEN_TARGET_NAME));
  assert(/^https:\/\/[a-z0-9.-]+\/radio$/.test(env.HAEN_TARGET_SITE));
  assert(/^[a-f0-9]{64}$/.test(env.HAEN_TARGET_DATABASE_FINGERPRINT));
  return {
    target: env.HAEN_TARGET_NAME,
    site: env.HAEN_TARGET_SITE,
    databaseFingerprint: env.HAEN_TARGET_DATABASE_FINGERPRINT,
  };
}
export async function componentPipeline(stage, env) {
  const directory = await outputDirectory();
  const descriptor = await sourceDescriptor(env);
  const run = docker(undefined, env);
  if (stage === 'describe') {
    await save(join(directory, 'component-source.json'), descriptor);
    return;
  }
  if (stage === 'build') {
    assert.equal(await localEngine(run), descriptor.platform);
    const nonce = randomBytes(6).toString('hex'),
      images = {};
    const targets =
      descriptor.component === 'frontend'
        ? [['image', 'web', 'frontend']]
        : [
            ['image', 'server', descriptor.component],
            ...(env.HAEN_BUILD_MIGRATION === 'true'
              ? [['migration', 'migration', 'migration']]
              : []),
          ];
    for (const [key, target, repository] of targets) {
      const tag = 'radio-local/' + repository + ':' + descriptor.revision + '-' + nonce;
      await run(
        [
          'build',
          '--pull',
          '--platform',
          descriptor.platform,
          '--file',
          'deploy/docker/Dockerfile',
          '--target',
          target,
          '--build-arg',
          'VCS_REF=' + descriptor.revision,
          '--build-arg',
          'HAEN_WEB_BASE_PATH=/radio/',
          '--label',
          'io.haen.project=radio',
          '--label',
          'io.haen.component=' + repository,
          '--tag',
          tag,
          '.',
        ],
        { capture: false, timeout: 1800000 },
      );
      const image = await imageIdentity(run, tag, descriptor.revision, descriptor.platform);
      images[key] = { tag, id: image.Id };
    }
    await save(join(directory, 'component-build.json'), {
      ...descriptor,
      validationRun: nonce,
      images,
    });
    return;
  }
  if (stage === 'seal') {
    const release = componentRelease(await load(join(directory, 'component-release.json')));
    for (const [key, value] of Object.entries(descriptor)) assert.deepEqual(release[key], value);
    await save(join(directory, 'component-handoff.json'), {
      format: 2,
      ...context(env),
      engineId: await engineIdentity(run),
      release,
    });
    return sha(await readFile(join(directory, 'component-handoff.json')));
  }
  if (stage === 'accept') {
    const path = join(directory, 'component-handoff.json'),
      stat = await lstat(path);
    assert(
      stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.nlink === 1 &&
        stat.uid === process.getuid() &&
        stat.size < 1024 * 1024,
    );
    const bytes = await readFile(path);
    assert.equal(sha(bytes), env.HAEN_APPROVED_HANDOFF_SHA256);
    const value = JSON.parse(bytes);
    assert.deepEqual(
      Object.keys(value).sort(),
      ['format', ...Object.keys(context(env)), 'engineId', 'release'].sort(),
    );
    assert.equal(value.format, 2);
    assert.equal(
      value.engineId,
      await engineIdentity(run),
      'Build and target must share one Docker engine',
    );
    for (const [key, expected] of Object.entries(context(env))) assert.equal(value[key], expected);
    const release = componentRelease(value.release);
    for (const [key, expected] of Object.entries(descriptor))
      assert.deepEqual(release[key], expected);
    await checkedDeployEnvironment(env.HAEN_DEPLOY_ENV_FILE, env.HAEN_JENKINS_WORKSPACE_ROOT);
    await chmod(path, 0o600);
    await save(join(directory, 'target-release.json'), release);
    return sha(await readFile(join(directory, 'target-release.json')));
  }
  const build = await load(join(directory, 'component-build.json'));
  for (const [key, value] of Object.entries(descriptor)) assert.deepEqual(build[key], value);
  for (const item of Object.values(build.images))
    assert.equal((await imageIdentity(run, item.tag, build.revision, build.platform)).Id, item.id);
  if (stage === 'test') {
    if (descriptor.component === 'frontend') {
      const work = await mkdtemp(join(directory, '.static-check-'));
      try {
        const candidate = {
          ...descriptor,
          image: build.images.image.tag,
          migrationImage: null,
          validationRun: build.validationRun,
        };
        await prepareStaticWeb(run, webRelease(candidate), { staticDirectory: work });
        const html = await readFile(
          join(work, 'releases', build.images.image.id.slice(7), 'site/index.html'),
          'utf8',
        );
        assert(/(?:src|href)="\/radio\/assets\//.test(html));
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    } else {
      await run([
        'run',
        '--rm',
        '--name',
        'radio-check-' + build.component + '-' + build.validationRun,
        '--network',
        'none',
        '--read-only',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges:true',
        '--tmpfs',
        '/tmp:size=16m,mode=1777',
        build.images.image.tag,
        '--input-type=module',
        '-e',
        'await import("./dist/app.js");await import("node-cron");await import("./dist/db/schema.js");',
      ]);
      if (build.images.migration)
        await run([
          'run',
          '--rm',
          '--name',
          'radio-check-migration-' + build.validationRun,
          '--network',
          'none',
          '--read-only',
          '--tmpfs',
          '/tmp:size=16m,mode=1777',
          '--entrypoint',
          'node',
          build.images.migration.tag,
          '--input-type=module',
          '-e',
          'import {expectedMigrations} from "./dist/operations/migration-plan.js";if(!(await expectedMigrations()).length)process.exit(1);',
        ]);
    }
    await save(join(directory, 'component-check.json'), {
      revision: build.revision,
      component: build.component,
      validationRun: build.validationRun,
      images: build.images,
      passed: true,
    });
    return;
  }
  assert.equal(stage, 'publish');
  const check = await load(join(directory, 'component-check.json'));
  assert.deepEqual(check, {
    revision: build.revision,
    component: build.component,
    validationRun: build.validationRun,
    images: build.images,
    passed: true,
  });
  const image = await localImage(run, build.images.image, build.revision, build.platform);
  const migrationImage = build.images.migration
    ? await localImage(run, build.images.migration, build.revision, build.platform)
    : null;
  await save(
    join(directory, 'component-release.json'),
    componentRelease({ ...descriptor, image, migrationImage, validationRun: build.validationRun }),
  );
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = await componentPipeline(process.argv[2], process.env);
    if (result) console.info(result);
  } catch {
    console.error(JSON.stringify({ event: 'component_pipeline_failed', stage: process.argv[2] }));
    process.exitCode = 1;
  }
}
