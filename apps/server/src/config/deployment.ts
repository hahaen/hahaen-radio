import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
const digest = /^[a-f0-9]{64}$/;
export function verifyDeploymentExpectations(env: NodeJS.ProcessEnv, targetFingerprint: string) {
  if (env.HAEN_CI_DEPLOY === 'true') {
    if (
      env.CI !== 'true' ||
      env.HAEN_DEPLOY_ACTION !== 'apply' ||
      !digest.test(env.HAEN_EXPECTED_DATABASE_FINGERPRINT ?? '') ||
      !digest.test(env.HAEN_EXPECTED_RELEASE_SHA256 ?? '') ||
      !/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?:\/[a-z0-9-]+)*$/.test(
        env.HAEN_EXPECTED_SITE ?? '',
      ) ||
      !['full', 'web', 'server'].includes(env.HAEN_DEPLOY_SCOPE ?? '')
    )
      throw Error('Invalid approved deployment context');
  }
  if (
    env.HAEN_EXPECTED_DATABASE_FINGERPRINT &&
    env.HAEN_EXPECTED_DATABASE_FINGERPRINT !== targetFingerprint
  )
    throw Error('Deployment target mismatch');
  if (env.HAEN_EXPECTED_RELEASE_SHA256) {
    if (
      !digest.test(env.HAEN_EXPECTED_RELEASE_SHA256) ||
      !env.HAEN_RELEASE_FILE ||
      !isAbsolute(env.HAEN_RELEASE_FILE)
    )
      throw Error('Invalid approved release file');
    const stat = lstatSync(env.HAEN_RELEASE_FILE);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o777) !== 0o600 ||
      stat.size >= 1024 * 1024
    )
      throw Error('Invalid private release file');
    if (
      createHash('sha256').update(readFileSync(env.HAEN_RELEASE_FILE)).digest('hex') !==
      env.HAEN_EXPECTED_RELEASE_SHA256
    )
      throw Error('Approved release content changed');
  }
}
