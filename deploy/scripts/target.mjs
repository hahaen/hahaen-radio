import assert from 'node:assert/strict';
import { lstat, readFile, open, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { privateDirectory, load } from './release/common.mjs';
const pathValue = (value) => {
  assert(
    typeof value === 'string' && /^\/[A-Za-z0-9_@./-]+$/.test(value) && resolve(value) === value,
  );
  return value;
};
async function privateFile(path) {
  pathValue(path);
  const stat = await lstat(path);
  assert(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.nlink === 1 &&
      (stat.mode & 0o777) === 0o600 &&
      stat.size <= 65536 &&
      stat.uid === process.getuid(),
  );
  return readFile(path, 'utf8');
}
export async function targetConfiguration(path, database, expectedSite) {
  const config = JSON.parse(await privateFile(path));
  assert.deepEqual(
    Object.keys(config).sort(),
    [
      'apiEnvFile',
      'databaseCaFile',
      'environment',
      'format',
      'jobsEnvFile',
      'maintenanceDirectory',
      'migrationEnvFile',
      'site',
      'stateDirectory',
      'staticDirectory',
    ].sort(),
  );
  assert(config.format === 1 && config.environment === 'production');
  assert(/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?:\/[a-z0-9-]+)*$/.test(config.site));
  if (expectedSite) assert.equal(config.site, expectedSite);
  assert.equal(new URL(config.site).pathname, '/radio');
  for (const key of ['apiEnvFile', 'jobsEnvFile', 'migrationEnvFile']) {
    const values = {};
    for (const line of (await privateFile(config[key])).split('\n')) {
      if (!line.trim() || line.startsWith('#')) continue;
      const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
      assert(match && !Object.hasOwn(values, match[1]));
      values[match[1]] = match[2];
    }
    assert.equal(values.DB_HOST, database.host);
    assert.equal(Number(values.DB_PORT || 3306), database.port);
    assert(!values.DB_NAME || values.DB_NAME === 'ha_radio');
    assert(!values.DB_TLS || values.DB_TLS === 'required');
    assert(!values.NODE_ENV || values.NODE_ENV === 'production');
    assert(values.DB_USER && values.DB_PASSWORD);
    assert(
      !Object.keys(values).some((key) => key.startsWith('COMPOSE_') || key.startsWith('VITE_')),
    );
  }
  const ca = pathValue(config.databaseCaFile),
    caStat = await lstat(ca);
  assert(caStat.isFile() && !caStat.isSymbolicLink() && (caStat.mode & 0o022) === 0);
  // The outer release lock and the containers must trust the same CA bytes and target.
  assert.equal(await readFile(ca, 'utf8'), database.ssl?.ca);
  assert(
    database.ssl?.rejectUnauthorized &&
      database.ssl?.verifyIdentity &&
      database.database === 'ha_radio',
  );
  await privateDirectory(pathValue(config.stateDirectory));
  const visible = await lstat(pathValue(config.maintenanceDirectory));
  assert(
    visible.isDirectory() &&
      !visible.isSymbolicLink() &&
      visible.uid === process.getuid() &&
      (visible.mode & 0o777) === 0o755,
  );
  assert(
    config.stateDirectory !== config.maintenanceDirectory &&
      !config.maintenanceDirectory.startsWith(config.stateDirectory + '/') &&
      !config.stateDirectory.startsWith(config.maintenanceDirectory + '/'),
  );
  const web = await lstat(pathValue(config.staticDirectory));
  assert(
    web.isDirectory() &&
      !web.isSymbolicLink() &&
      web.uid === process.getuid() &&
      (web.mode & 0o777) === 0o755,
  );
  for (const path of [config.stateDirectory, config.maintenanceDirectory]) {
    assert(
      path !== config.staticDirectory &&
        !path.startsWith(config.staticDirectory + '/') &&
        !config.staticDirectory.startsWith(path + '/'),
    );
  }
  return config;
}
export async function replaceState(path, value) {
  const pending = path + '.pending-' + randomBytes(6).toString('hex');
  const handle = await open(pending, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(JSON.stringify(value, null, 2) + '\n');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(pending, path);
    const directory = await open(dirname(path), 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await unlink(pending).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

export async function synchronizeRuntimeEnvironment(env) {
  assert.equal(env.RADIO_ENV_FORMAT, '1');
  const config = JSON.parse(await privateFile(env.HAEN_TARGET_CONFIG_FILE));
  assert(['frontend', 'api', 'jobs'].includes(env.HAEN_DEPLOY_SCOPE));
  let installed = {};
  try {
    installed = (await load(join(pathValue(config.stateDirectory), 'state.json'))).components;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const selected = env.HAEN_DEPLOY_SCOPE.toUpperCase();
  const writes = [];
  for (const [role, key] of [
    ['API', 'apiEnvFile'],
    ['JOBS', 'jobsEnvFile'],
    ['MIGRATION', 'migrationEnvFile'],
  ]) {
    if (
      role !== 'MIGRATION' &&
      role !== selected &&
      !(role === 'JOBS' && selected === 'API' && !installed.jobs)
    )
      continue;
    await privateFile(config[key]);
    const prefix = 'RADIO_' + role + '_';
    const values = Object.fromEntries(
      Object.entries(env)
        .filter(([name]) => name.startsWith(prefix))
        .map(([name, value]) => [name.slice(prefix.length), value]),
    );
    assert(
      values.DB_HOST === env.DB_HOST &&
        Number(values.DB_PORT || 3306) === Number(env.DB_PORT || 3306),
    );
    assert(values.DB_USER && values.DB_PASSWORD);
    for (const [name, value] of Object.entries(values)) {
      assert(/^[A-Z][A-Z0-9_]*$/.test(name) && typeof value === 'string' && !/[\r\n]/.test(value));
      assert(!/^(VITE_|COMPOSE_|DOCKER_|LD_|DYLD_|NPM_|PNPM_)/.test(name));
      assert(!name.startsWith('NODE_') || name === 'NODE_ENV');
    }
    assert(!values.DB_NAME || values.DB_NAME === 'ha_radio');
    assert(!values.DB_TLS || values.DB_TLS === 'required');
    const text =
      Object.entries(values)
        .map(([name, value]) => name + '=' + value)
        .join('\n') + '\n';
    assert(Buffer.byteLength(text) <= 65536);
    writes.push([config[key], text]);
  }
  for (const [path, text] of writes) await writeFile(path, text, { mode: 0o600 });
}
export { executeComponentTarget as executeTarget } from './component-target.mjs';
