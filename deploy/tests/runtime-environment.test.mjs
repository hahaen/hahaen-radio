import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { synchronizeRuntimeEnvironment } from '../scripts/target.mjs';
const roots = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(component = 'api') {
  const root = await mkdtemp(join(tmpdir(), 'radio-env-'));
  roots.push(root);
  const config = {
    stateDirectory: join(root, 'state'),
    apiEnvFile: join(root, 'api.env'),
    jobsEnvFile: join(root, 'jobs.env'),
    migrationEnvFile: join(root, 'migration.env'),
  };
  await mkdir(config.stateDirectory, { mode: 0o700 });
  await writeFile(
    join(config.stateDirectory, 'state.json'),
    JSON.stringify({ format: 2, components: { api: {}, jobs: {} } }),
    { mode: 0o600 },
  );
  const path = join(root, 'target.json');
  await writeFile(path, JSON.stringify(config), { mode: 0o600 });
  const env = {
    RADIO_ENV_FORMAT: '1',
    HAEN_TARGET_CONFIG_FILE: path,
    HAEN_DEPLOY_SCOPE: component,
    DB_HOST: 'db.example',
    DB_PORT: '3306',
  };
  for (const [role, key] of [
    ['API', 'apiEnvFile'],
    ['JOBS', 'jobsEnvFile'],
    ['MIGRATION', 'migrationEnvFile'],
  ]) {
    await writeFile(config[key], 'original-' + role, { mode: 0o600 });
    for (const [name, value] of Object.entries({
      DB_HOST: env.DB_HOST,
      DB_USER: 'test-role',
      DB_PASSWORD: 'literal#quotes\'"$',
      DB_NAME: 'ha_radio',
      DB_TLS: 'required',
    }))
      env['RADIO_' + role + '_' + name] = value;
  }
  return { env, config };
}
it.each(['api', 'jobs', 'frontend'])(
  'loads %s configuration explicitly without rewriting the other active role',
  async (component) => {
    const f = await fixture(component);
    await synchronizeRuntimeEnvironment(f.env);
    for (const [role, key] of [
      ['API', 'apiEnvFile'],
      ['JOBS', 'jobsEnvFile'],
    ]) {
      const text = await readFile(f.config[key], 'utf8');
      if (role.toLowerCase() === component)
        expect(text).toContain('DB_PASSWORD=literal#quotes\'"$\n');
      else expect(text).toBe('original-' + role);
      expect((await stat(f.config[key])).mode & 0o777).toBe(0o600);
    }
  },
);
it('rejects frontend secrets, control variables, newlines and a different database', async () => {
  for (const [name, value] of [
    ['VITE_PASSWORD', 'bad'],
    ['NODE_OPTIONS', '--inspect'],
    ['DB_PASSWORD', 'bad\nINJECTED=true'],
    ['DB_NAME', 'ha_radio_dev'],
  ]) {
    const f = await fixture();
    f.env['RADIO_API_' + name] = value;
    await expect(synchronizeRuntimeEnvironment(f.env)).rejects.toThrow();
  }
});
