import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyPublishedImage } from '../scripts/published-image.mjs';
import { execFileSync } from 'node:child_process';
const roots = [],
  script = resolve('deploy/scripts/component-release.mjs');
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'radio-handoff-'));
  roots.push(root);
  const cwd = join(root, 'source');
  await mkdir(cwd);
  for (const folder of [
    'packages/contracts/src/nested',
    'apps/server/migrations/meta',
    'deploy/compatibility',
  ])
    await mkdir(join(cwd, folder), { recursive: true });
  const put = (name, value) => writeFile(join(cwd, name), value);
  await put('packages/contracts/src/nested/dto.ts', 'export const version = 1;');
  await put(
    'apps/server/migrations/meta/_journal.json',
    JSON.stringify({ entries: [{ tag: '0000_initial' }] }),
  );
  await put('apps/server/migrations/0000_initial.sql', 'CREATE TABLE sample(id INT);');
  await put(
    'deploy/compatibility/policy.json',
    JSON.stringify({ format: 1, compatibleContracts: [], compatibleSchemas: [] }),
  );
  const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
  git('init', '-q');
  git('add', 'packages', 'apps', 'deploy');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture');
  const env = {
    ...process.env,
    CI: 'true',
    HAEN_DEPLOY_SCOPE: 'frontend',
    HAEN_SOURCE_COMMIT: git('rev-parse', 'HEAD'),
    HAEN_RELEASE_PLATFORM: 'linux/amd64',
    HAEN_TARGET_NAME: 'radio-production',
    HAEN_TARGET_SITE: 'https://example.invalid/radio',
    HAEN_TARGET_DATABASE_FINGERPRINT: 'a'.repeat(64),
  };
  const run = (stage, extra = {}) =>
    execFileSync(process.execPath, [script, stage], {
      cwd,
      env: { ...env, ...extra },
      stdio: 'pipe',
    })
      .toString()
      .trim();
  const directory = join(cwd, '.local/archive/release-pipeline');
  run('describe');
  const source = JSON.parse(await readFile(join(directory, 'component-source.json'), 'utf8'));
  return { root, cwd, put, git, env, run, directory, source };
}
it('includes nested contract files in compatibility fingerprints', async () => {
  const f = await fixture(),
    previous = f.source.contractHash;
  await f.put('packages/contracts/src/nested/dto.ts', 'export const version = 2;');
  f.git('add', 'packages');
  f.git(
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '-qm',
    'changed contract',
  );
  await rm(join(f.directory, 'component-source.json'));
  f.run('describe', { HAEN_SOURCE_COMMIT: f.git('rev-parse', 'HEAD') });
  expect(
    JSON.parse(await readFile(join(f.directory, 'component-source.json'), 'utf8')).contractHash,
  ).not.toBe(previous);
});
it('binds immutable component metadata to the approved digest and target context', async () => {
  const f = await fixture();
  await writeFile(
    join(f.directory, 'component-release.json'),
    JSON.stringify({
      ...f.source,
      image: 'registry.example/radio/frontend@sha256:' + 'b'.repeat(64),
      migrationImage: null,
      validationRun: 'b'.repeat(12),
    }),
    { mode: 0o600 },
  );
  const digest = f.run('seal');
  expect(digest).toMatch(/^[a-f0-9]{64}$/);
  const main = join(f.root, 'radio-prod.env');
  await writeFile(main, 'NODE_ENV=production\n', { mode: 0o600 });
  const extra = { HAEN_APPROVED_HANDOFF_SHA256: digest, HAEN_DEPLOY_ENV_FILE: main };
  expect(() =>
    f.run('accept', { ...extra, HAEN_TARGET_SITE: 'https://another.invalid/radio' }),
  ).toThrow();
  expect(() =>
    f.run('accept', { ...extra, HAEN_APPROVED_HANDOFF_SHA256: 'c'.repeat(64) }),
  ).toThrow();
  expect(f.run('accept', extra)).toMatch(/^[a-f0-9]{64}$/);
  expect(
    JSON.parse(await readFile(join(f.directory, 'target-release.json'), 'utf8')).component,
  ).toBe('frontend');
});

it('binds Docker containerd index identities to the native manifest, while retaining legacy config digest checks', () => {
  const revision = 'a'.repeat(40),
    reference = 'registry.example/radio/api@sha256:' + 'b'.repeat(64);
  const native = {
    Id: 'sha256:' + 'b'.repeat(64),
    Descriptor: {
      digest: 'sha256:' + 'b'.repeat(64),
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
    },
    Config: { Labels: { 'org.opencontainers.image.revision': revision } },
    Os: 'linux',
    Architecture: 'amd64',
  };
  const index = {
    ...native,
    Id: 'sha256:' + 'c'.repeat(64),
    Descriptor: {
      digest: 'sha256:' + 'c'.repeat(64),
      mediaType: 'application/vnd.oci.image.index.v1+json',
    },
  };
  expect(() =>
    verifyPublishedImage(
      index,
      native,
      reference,
      { config: { digest: 'sha256:' + 'd'.repeat(64) } },
      revision,
      'linux/amd64',
    ),
  ).not.toThrow();
  expect(() =>
    verifyPublishedImage(
      index,
      native,
      reference.replace('b'.repeat(64), 'e'.repeat(64)),
      {},
      revision,
      'linux/amd64',
    ),
  ).toThrow();
  const legacy = { ...native, Id: 'sha256:' + 'd'.repeat(64) };
  delete legacy.Descriptor;
  expect(() =>
    verifyPublishedImage(
      legacy,
      legacy,
      reference,
      { config: { digest: legacy.Id } },
      revision,
      'linux/amd64',
    ),
  ).not.toThrow();
  expect(() =>
    verifyPublishedImage(
      legacy,
      legacy,
      reference,
      { config: { digest: 'sha256:' + 'e'.repeat(64) } },
      revision,
      'linux/amd64',
    ),
  ).toThrow();
});
