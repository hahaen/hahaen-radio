import { it, expect } from 'vitest';
import { mkdtemp, writeFile, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { verifyDeploymentExpectations } from './deployment.js';
it('binds approved artifact bytes and the actual database target before deployment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haen-deploy-expected-')),
    path = join(root, 'release.json'),
    bytes = '{"format":1}\n';
  try {
    await writeFile(path, bytes, { mode: 0o600 });
    const env = {
      CI: 'true',
      HAEN_CI_DEPLOY: 'true',
      HAEN_DEPLOY_ACTION: 'apply',
      HAEN_DEPLOY_SCOPE: 'full',
      HAEN_EXPECTED_SITE: 'https://radio.example.test',
      HAEN_EXPECTED_DATABASE_FINGERPRINT: 'a'.repeat(64),
      HAEN_EXPECTED_RELEASE_SHA256: createHash('sha256').update(bytes).digest('hex'),
      HAEN_RELEASE_FILE: path,
    };
    expect(() => verifyDeploymentExpectations(env, 'a'.repeat(64))).not.toThrow();
    expect(() => verifyDeploymentExpectations(env, 'b'.repeat(64))).toThrow('target mismatch');
    await writeFile(path, bytes + ' ');
    expect(() => verifyDeploymentExpectations(env, 'a'.repeat(64))).toThrow('content changed');
    await chmod(path, 0o644);
    expect(() => verifyDeploymentExpectations(env, 'a'.repeat(64))).toThrow('private release');
    expect(() =>
      verifyDeploymentExpectations({ ...env, HAEN_DEPLOY_ACTION: 'recover' }, 'a'.repeat(64)),
    ).toThrow('context');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('requires complete CI bindings while preserving explicit standalone deployment', () => {
  expect(() => verifyDeploymentExpectations({}, 'a'.repeat(64))).not.toThrow();
  expect(() => verifyDeploymentExpectations({ HAEN_CI_DEPLOY: 'true' }, 'a'.repeat(64))).toThrow();
});
