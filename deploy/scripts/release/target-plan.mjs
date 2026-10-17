import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { targetConfiguration } from '../target.mjs';

export async function targetPlan(env) {
  assert.equal(process.version, 'v24.9.0');
  assert.equal(env.CI, 'true');
  assert.equal(env.HAEN_CI_DEPLOY, 'true');
  const { readDatabaseConfig, databaseTargetFingerprint } =
    await import('../../../apps/server/dist/config/database.js');
  const { verifyDeploymentExpectations } =
    await import('../../../apps/server/dist/config/deployment.js');
  const { migrationStatus } =
    await import('../../../apps/server/dist/operations/migration-plan.js');
  const database = readDatabaseConfig(env);
  verifyDeploymentExpectations(env, databaseTargetFingerprint(database));
  const config = await targetConfiguration(
    env.HAEN_TARGET_CONFIG_FILE,
    database,
    env.HAEN_EXPECTED_SITE,
  );
  // Container env files use raw values, including literal hash and quote characters.
  const raw = Object.fromEntries(
    (await readFile(config.migrationEnvFile, 'utf8'))
      .split('\n')
      .filter((line) => line.trim() && !line.startsWith('#'))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );
  const migration = readDatabaseConfig({
    ...raw,
    NODE_ENV: 'production',
    DB_NAME: 'ha_radio',
    DB_TLS: 'required',
    DB_TLS_CA_PATH: config.databaseCaFile,
  });
  assert.equal(databaseTargetFingerprint(migration), databaseTargetFingerprint(database));
  const status = await migrationStatus(migration);
  return { empty: status.empty, pending: status.pending.length };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const plan = await targetPlan(process.env);
    console.info(`${plan.empty} ${plan.pending}`);
  } catch {
    console.error(JSON.stringify({ event: 'target_plan_failed' }));
    process.exitCode = 1;
  }
}
