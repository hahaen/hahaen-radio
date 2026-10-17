import { afterEach, expect, it } from 'vitest';
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
} from 'node:fs/promises';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { command, imageReference, registryFor, save, load } from '../scripts/release/common.mjs';
const exec = promisify(execFile),
  roots = [];
const entry = fileURLToPath(new URL('../scripts/release/pipeline.mjs', import.meta.url));
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'haen-release-test-'));
  roots.push(root);
  const bin = join(root, 'bin');
  await mkdir(bin);
  await mkdir(join(root, 'apps/server/migrations/meta'), { recursive: true });
  await copyFile(fileURLToPath(new URL('./fake-docker.mjs', import.meta.url)), join(bin, 'docker'));
  await chmod(join(bin, 'docker'), 0o700);
  const sharedIgnore = await readFile(
    fileURLToPath(new URL('../../.gitignore', import.meta.url)),
    'utf8',
  );
  await writeFile(join(root, '.gitignore'), sharedIgnore + '\nbin/\nstate*\nauth.json\n');
  await writeFile(
    join(root, 'apps/server/migrations/meta/_journal.json'),
    JSON.stringify({ entries: [{ tag: '0000_fixture' }] }),
  );
  await writeFile(
    join(root, 'apps/server/migrations/0000_fixture.sql'),
    'CREATE TABLE fixture(id int);',
  );
  await exec('git', ['init', '--quiet'], { cwd: root });
  await exec('git', ['add', '.gitignore', 'apps/server/migrations'], { cwd: root });
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
    { cwd: root },
  );
  const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: root });
  const state = join(root, 'state');
  await writeFile(
    state,
    JSON.stringify({
      images: {},
      networks: {},
      containers: { unrelated: { Labels: { owner: 'another' }, State: { Running: true } } },
    }),
  );
  const auth = join(root, 'auth.json');
  await writeFile(
    auth,
    JSON.stringify({ auths: { 'registry.example': { auth: 'c3ludGhldGljOnNlY3JldA==' } } }),
    { mode: 0o600 },
  );
  const env = {
    ...process.env,
    DOCKER_HOST: '',
    DOCKER_CONTEXT: '',
    CI: 'true',
    PATH: bin + delimiter + process.env.PATH,
    FAKE_DOCKER_STATE: state,
    HAEN_SOURCE_COMMIT: stdout.trim(),
    HAEN_IMAGE_REPOSITORY: 'registry.example/haen',
    HAEN_RELEASE_PLATFORM: 'linux/amd64',
    HAEN_TEST_MYSQL_IMAGE: 'registry.example/library/mysql@sha256:' + 'a'.repeat(64),
    HAEN_REGISTRY_CONFIG_FILE: auth,
  };
  const run = (stage, extra = {}) =>
    exec(process.execPath, [entry, stage], {
      cwd: root,
      env: { ...env, ...extra },
      timeout: 25000,
    });
  return {
    root,
    env,
    state,
    run,
    read: async (name) =>
      JSON.parse(
        await readFile(join(root, '.local/archive/release-pipeline', name + '.json'), 'utf8'),
      ),
  };
}
it('rejects credential-bearing image references and command failures without raw diagnostic output', async () => {
  expect(() => imageReference('https://user:password@registry.example/image')).toThrow();
  expect(() => registryFor('registry.example/project;touch')).toThrow();
  await expect(command('/nonexistent-haen-release', [])).rejects.toThrow('Release tool failed');
  await expect(
    command(process.execPath, ['-e', 'console.error("private");process.exit(2)']),
  ).rejects.toThrow('Release tool failed');
});
it('runs the real CLI against a simulated engine and produces only tested immutable references', async () => {
  const f = await fixture();
  await f.run('build');
  await f.run('test-images');
  await f.run('publish', { FAKE_INDEX: '1' });
  const build = await f.read('build'),
    check = await f.read('image-check'),
    release = await f.read('release');
  expect(check.checks.cleanup).toBe(true);
  expect(release.revision).toBe(build.revision);
  for (const value of Object.values(release.images)) expect(value).toMatch(/@sha256:[a-f0-9]{64}$/);
  const state = JSON.parse(await readFile(f.state, 'utf8'));
  expect(Object.keys(state.containers)).toEqual(['unrelated']);
  expect(state.networks).toEqual({});
  const files = await readdir(join(f.root, '.local/archive/release-pipeline'));
  expect(files.sort()).toEqual(['build.json', 'image-check.json', 'release.json']);
  const calls = await readFile(f.state + '.calls', 'utf8');
  expect(calls).not.toContain('c3ludGhldGljOnNlY3JldA==');
  expect(calls).not.toContain('system');
  expect(calls.split('\n').filter((line) => line.startsWith('["push"'))).toHaveLength(3);
}, 30000);
it('refuses publication before image validation and refuses a changed tag after validation', async () => {
  const f = await fixture();
  await f.run('build');
  await expect(f.run('publish')).rejects.toThrow();
  await f.run('test-images');
  await expect(f.run('publish', { FAKE_CHANGED_TAG: '1' })).rejects.toThrow();
  expect(await readFile(f.state + '.calls', 'utf8')).not.toContain('["push"');
  expect(
    (await readdir(join(f.root, '.local/archive/release-pipeline'))).some((name) =>
      name.startsWith('.registry-'),
    ),
  ).toBe(false);
}, 30000);
it('refuses release metadata when remote content differs from the image tested', async () => {
  const f = await fixture();
  await f.run('build');
  await f.run('test-images');
  await expect(f.run('publish', { FAKE_REMOTE_MISMATCH: '1' })).rejects.toThrow();
  await expect(f.read('release')).rejects.toThrow();
  expect(
    (await readdir(join(f.root, '.local/archive/release-pipeline'))).some((name) =>
      name.startsWith('.registry-'),
    ),
  ).toBe(false);
}, 30000);
it('does not certify cleanup after a failed removal and never deletes unrelated resources', async () => {
  const f = await fixture();
  await f.run('build');
  const result = await f.run('test-images', { FAKE_CLEANUP_FAILURE: '1' }).catch((error) => error);
  expect(result.stderr).toContain('release_stage_failed');
  expect(result.stderr).not.toContain('Synthetic private diagnostic');
  await expect(f.read('image-check')).rejects.toThrow();
  const state = JSON.parse(await readFile(f.state, 'utf8'));
  expect(state.containers.unrelated.State.Running).toBe(true);
  expect(
    (await readdir(join(f.root, '.local/archive/release-pipeline'))).some((name) =>
      name.startsWith('.smoke-'),
    ),
  ).toBe(false);
}, 30000);

it('terminates a resistant child after bounded-output cancellation before returning', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haen-release-cap-'));
  roots.push(root);
  const receipt = join(root, 'pid');
  await expect(
    command(process.execPath, [
      '--input-type=module',
      '-e',
      'import{writeFileSync}from"node:fs";process.on("SIGTERM",()=>{});writeFileSync(process.argv[1],String(process.pid));process.stdout.write("x".repeat(5*1024*1024));setInterval(()=>{},1000);',
      receipt,
    ]),
  ).rejects.toThrow('Release tool failed');
  const pid = Number(await readFile(receipt, 'utf8'));
  expect(pid).toBeGreaterThan(0);
  expect(() => process.kill(pid, 0)).toThrow();
}, 10000);

it('publishes complete metadata exclusively and preserves an earlier receipt on repeat', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haen-release-receipt-'));
  roots.push(root);
  const path = join(root, 'receipt.json');
  await save(path, { format: 1, verified: true });
  await expect(save(path, { format: 1, verified: false })).rejects.toThrow();
  expect(await load(path)).toEqual({ format: 1, verified: true });
  expect(await readdir(root)).toEqual(['receipt.json']);
});
