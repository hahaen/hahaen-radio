import { it, expect, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  copyFile,
  chmod,
  rm,
  readdir,
  stat,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const exec = promisify(execFile),
  roots = [],
  entry = fileURLToPath(new URL('../../scripts/release/handoff.mjs', import.meta.url));
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'haen-handoff-'));
  roots.push(root);
  const source = join(root, 'source'),
    target = join(root, 'target'),
    secret = join(root, 'deploy.env');
  await mkdir(source);
  await mkdir(join(source, 'migrations/meta'), { recursive: true });
  const sql = 'CREATE TABLE fixture(id int);';
  await writeFile(join(source, 'migrations/0000_fixture.sql'), sql);
  await writeFile(
    join(source, 'migrations/meta/_journal.json'),
    JSON.stringify({ entries: [{ tag: '0000_fixture' }] }),
  );
  await exec('git', ['init', '--quiet'], { cwd: source });
  await exec('git', ['add', '--', 'migrations'], { cwd: source });
  await exec(
    'git',
    [
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    ],
    { cwd: source },
  );
  const revision = (await exec('git', ['rev-parse', 'HEAD'], { cwd: source })).stdout.trim();
  await exec('git', ['clone', '--quiet', '--no-hardlinks', source, target]);
  const directory = join(source, '.local/archive/release-pipeline');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const roles = ['web', 'server', 'migration'],
    repository = 'registry.example.test/haen',
    run = 'a'.repeat(12),
    platform = 'linux/amd64';
  const images = Object.fromEntries(
    roles.map((role, i) => [
      role,
      { id: 'sha256:' + String(i + 1).repeat(64), tag: `${repository}/${role}:${revision}-${run}` },
    ]),
  );
  const migrations = [
    { file: '0000_fixture.sql', sha256: createHash('sha256').update(sql).digest('hex') },
  ];
  const build = { format: 1, revision, repository, run, platform, images, migrations };
  const check = {
    format: 1,
    revision,
    run,
    mysql: '8.0.46',
    migrations: 1,
    tables: 2,
    images: Object.fromEntries(roles.map((role) => [role, images[role].id])),
    checks: Object.fromEntries(
      ['migration', 'repeatedMigration', 'api', 'jobs', 'web', 'staticAsset', 'cleanup'].map(
        (key) => [key, true],
      ),
    ),
  };
  const release = {
    format: 1,
    revision,
    platform,
    images: Object.fromEntries(
      roles.map((role) => [role, repository + '/' + role + '@' + images[role].id]),
    ),
    migrations,
    imageCheckRun: run,
  };
  for (const [name, value] of Object.entries({ build, 'image-check': check, release }))
    await writeFile(join(directory, name + '.json'), JSON.stringify(value), { mode: 0o600 });
  await writeFile(secret, 'NODE_ENV=production\nDB_PASSWORD=fixture-private-value\n', {
    mode: 0o600,
  });
  const env = {
    ...process.env,
    CI: 'true',
    HAEN_SOURCE_COMMIT: revision,
    HAEN_RELEASE_PLATFORM: platform,
    HAEN_TARGET_NAME: 'fixture-target',
    HAEN_TARGET_SITE: 'https://radio.example.test',
    HAEN_TARGET_DATABASE_FINGERPRINT: 'b'.repeat(64),
    HAEN_DEPLOY_SCOPE: 'server',
    HAEN_DEPLOY_ENV_FILE: secret,
  };
  const runCli = (stage, cwd = source, extra = {}) =>
    exec(process.execPath, [entry, stage], { cwd, env: { ...env, ...extra }, timeout: 10000 });
  const transfer = async () => {
    await runCli('prepare-target', target);
    const dest = join(target, '.local/archive/release-pipeline/deploy-handoff.json');
    await copyFile(join(directory, 'deploy-handoff.json'), dest);
    await chmod(dest, 0o644);
    return dest;
  };
  return { root, source, target, directory, secret, env, runCli, transfer, release };
}
it('seals checked immutable metadata, transfers across clean checkouts and restores private executable input', async () => {
  const f = await fixture(),
    seal = (await f.runCli('seal')).stdout.trim();
  expect(seal).toMatch(/^[a-f0-9]{64}$/);
  const handoff = await f.transfer();
  const digest = (
    await f.runCli('accept', f.target, {
      HAEN_APPROVED_HANDOFF_SHA256: seal,
      HAEN_JENKINS_WORKSPACE_ROOT: join(f.root, 'missing-old-workspace'),
    })
  ).stdout.trim();
  const targetRelease = join(f.target, '.local/archive/release-pipeline/target-release.json'),
    bytes = await readFile(targetRelease);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(digest);
  expect(JSON.parse(bytes)).toEqual(f.release);
  expect((await stat(handoff)).mode & 0o777).toBe(0o600);
  expect((await stat(targetRelease)).mode & 0o777).toBe(0o600);
  expect(await readFile(handoff, 'utf8')).not.toContain('fixture-private-value');
  await expect(
    f.runCli('accept', f.target, { HAEN_APPROVED_HANDOFF_SHA256: seal }),
  ).rejects.toThrow();
});
it('rejects changed bytes or a different target, site, fingerprint or scope before producing target input', async () => {
  const f = await fixture(),
    seal = (await f.runCli('seal')).stdout.trim(),
    path = await f.transfer();
  for (const changed of [
    { HAEN_DEPLOY_SCOPE: 'web' },
    { HAEN_TARGET_NAME: 'other-target' },
    { HAEN_TARGET_SITE: 'https://other.example.test' },
    { HAEN_TARGET_DATABASE_FINGERPRINT: 'c'.repeat(64) },
  ]) {
    const result = await f
      .runCli('accept', f.target, { HAEN_APPROVED_HANDOFF_SHA256: seal, ...changed })
      .catch((e) => e);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('deployment_handoff_failed');
    expect(result.stderr).not.toContain('fixture-private-value');
  }
  await writeFile(path, (await readFile(path, 'utf8')) + ' ');
  await expect(
    f.runCli('accept', f.target, { HAEN_APPROVED_HANDOFF_SHA256: seal }),
  ).rejects.toThrow();
  expect(await readdir(join(f.target, '.local/archive/release-pipeline'))).toEqual([
    'deploy-handoff.json',
  ]);
});
it('requires matching image checks and refuses unknown credential fields in release metadata', async () => {
  const f = await fixture();
  await writeFile(
    join(f.directory, 'release.json'),
    JSON.stringify({ ...f.release, token: 'fixture-private-value' }),
  );
  const failure = await f.runCli('seal').catch((e) => e);
  expect(failure.stderr).toContain('deployment_handoff_failed');
  expect(failure.stderr).not.toContain('fixture-private-value');
  await writeFile(
    join(f.directory, 'release.json'),
    JSON.stringify({ ...f.release, imageCheckRun: 'c'.repeat(12) }),
  );
  await expect(f.runCli('seal')).rejects.toThrow();
  expect((await readdir(f.directory)).includes('deploy-handoff.json')).toBe(false);
  await writeFile(join(f.directory, 'release.json'), JSON.stringify(f.release));
  const build = JSON.parse(await readFile(join(f.directory, 'build.json'), 'utf8')),
    check = JSON.parse(await readFile(join(f.directory, 'image-check.json'), 'utf8'));
  const original = build.revision;
  build.revision = 'c'.repeat(40);
  check.revision = build.revision;
  for (const image of Object.values(build.images))
    image.tag = image.tag.replace(original, build.revision);
  await writeFile(join(f.directory, 'build.json'), JSON.stringify(build));
  await writeFile(join(f.directory, 'image-check.json'), JSON.stringify(check));
  await expect(f.runCli('seal')).rejects.toThrow();
});
it('refuses a private environment inside the workspace, unsafe mode, or startup options without exposing values', async () => {
  const f = await fixture(),
    seal = (await f.runCli('seal')).stdout.trim();
  await f.transfer();
  await chmod(f.secret, 0o644);
  await expect(
    f.runCli('accept', f.target, { HAEN_APPROVED_HANDOFF_SHA256: seal }),
  ).rejects.toThrow();
  await chmod(f.secret, 0o600);
  await expect(
    f.runCli('accept', f.target, {
      HAEN_APPROVED_HANDOFF_SHA256: seal,
      HAEN_JENKINS_WORKSPACE_ROOT: f.root,
    }),
  ).rejects.toThrow();
  await writeFile(f.secret, 'NODE_ENV=production\nNODE_OPTIONS=--require=fixture-private-value\n');
  const failure = await f
    .runCli('accept', f.target, { HAEN_APPROVED_HANDOFF_SHA256: seal })
    .catch((e) => e);
  expect(failure.stderr).not.toContain('fixture-private-value');
  expect(failure.stderr).toContain('deployment_handoff_failed');
  const inner = join(f.target, '.local/archive/release-pipeline/deploy.env');
  await writeFile(inner, 'NODE_ENV=production\n', { mode: 0o600 });
  await expect(
    f.runCli('accept', f.target, {
      HAEN_APPROVED_HANDOFF_SHA256: seal,
      HAEN_DEPLOY_ENV_FILE: inner,
    }),
  ).rejects.toThrow();
});
