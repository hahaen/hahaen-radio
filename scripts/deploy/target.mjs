import assert from 'node:assert/strict';
import { lstat, readFile, open, rename, unlink, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  command,
  docker,
  localEngine,
  load,
  save,
  privateDirectory,
  roles,
} from '../release/common.mjs';
import {
  currentSource,
  imageIdentity,
  registryConfiguration,
  sourceMigrations,
} from '../release/images.mjs';
import { deployFlow, validateRelease } from './flow.mjs';
import { assertRuntimeLogImage, runtimeLogProbe } from './runtime-logs.mjs';

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
    ].sort(),
  );
  assert(config.format === 1 && config.environment === 'production');
  assert(/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(config.site));
  if (expectedSite) assert.equal(config.site, expectedSite);
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
export async function executeTarget(env, signal, database, targetFingerprint) {
  assert(/^[a-f0-9]{64}$/.test(targetFingerprint));
  assert.equal(process.platform, 'linux');
  assert.equal(process.version, 'v24.9.0');
  const config = await targetConfiguration(
    env.HAEN_TARGET_CONFIG_FILE,
    database,
    env.HAEN_EXPECTED_SITE,
  );
  const action = env.HAEN_DEPLOY_ACTION || 'apply',
    scope = env.HAEN_DEPLOY_SCOPE || 'full';
  assert(!env.HAEN_RECOVERY_VERSION || ['current', 'attempt'].includes(env.HAEN_RECOVERY_VERSION));
  const release =
    action === 'apply' ? validateRelease(await load(pathValue(env.HAEN_RELEASE_FILE))) : undefined;
  const statePath = join(config.stateDirectory, 'state.json'),
    marker = join(config.maintenanceDirectory, 'enabled');
  let state;
  try {
    state = await load(statePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    state = { format: 1 };
  }
  const work = await mkdtemp(join(config.stateDirectory, '.deploy-'));
  let auth;
  const baseEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^COMPOSE_|^DOCKER_CONFIG$|^NODE_OPTIONS$/.test(key),
    ),
  );
  let run = docker(signal, baseEnv),
    cleanup = docker(undefined, baseEnv);
  let cleanMode = false;
  let selected;
  const initialRestarts = new Map();
  const invoke = (args, options) => (cleanMode ? cleanup : run)(args, options);
  const compose = async (value, args, options) => {
    const variables = {
      HAEN_WEB_IMAGE: value.images.web,
      HAEN_SERVER_IMAGE: value.images.server,
      HAEN_MIGRATION_IMAGE: value.images.migration,
      HAEN_SITE: config.site,
      HAEN_DB_CA_FILE: config.databaseCaFile,
      HAEN_API_ENV_FILE: config.apiEnvFile,
      HAEN_JOBS_ENV_FILE: config.jobsEnvFile,
      HAEN_MIGRATION_ENV_FILE: config.migrationEnvFile,
      HAEN_MAINTENANCE_DIRECTORY: config.maintenanceDirectory,
    };
    const file = join(work, 'compose.env');
    const fd = await open(file, 'w', 0o600);
    try {
      await fd.writeFile(
        Object.entries(variables)
          .map(([key, value]) => key + '=' + value)
          .join('\n') + '\n',
      );
    } finally {
      await fd.close();
    }
    return invoke(
      [
        'compose',
        '--project-name',
        'haen',
        '--env-file',
        file,
        '--file',
        resolve('deploy/compose/compose.yaml'),
        ...args,
      ],
      options,
    );
  };
  const instances = async (service) => {
    const ids = (
      await invoke([
        'ps',
        '--all',
        '--quiet',
        '--filter',
        'label=com.docker.compose.project=haen',
        '--filter',
        'label=com.docker.compose.service=' + service,
      ])
    )
      .split(/\s+/)
      .filter(Boolean);
    assert(ids.length <= 1);
    if (!ids.length) return [];
    assert(ids.every((id) => /^[a-f0-9]{12,64}$/.test(id)));
    const rows = JSON.parse(await invoke(['inspect', ...ids]));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].Config.Labels['com.docker.compose.project'], 'haen');
    assert.equal(rows[0].Config.Labels['com.docker.compose.service'], service);
    return rows;
  };
  const assertRuntime = async (value, services, stopped = false) => {
    for (const service of services) {
      const rows = await instances(service);
      if (stopped) {
        assert(rows.every((row) => row.State.Running === false));
        continue;
      }
      assert.equal(rows.length, 1);
      const row = rows[0],
        role = service === 'web' ? 'web' : 'server';
      const image = await imageIdentity(
        invoke,
        value.images[role],
        value.imageRevisions[role],
        value.platform,
      );
      assert.equal(row.Image, image.Id);
      assert(
        row.State.Running &&
          !row.State.Restarting &&
          row.RestartCount === (initialRestarts.get(row.Id) ?? 0),
      );
      if (service !== 'jobs') assert.equal(row.State.Health?.Status, 'healthy');
    }
  };
  const probe = async (expected) => {
    const current = state.current ?? selected;
    const text = await compose(current, [
      'exec',
      '--no-TTY',
      'web',
      'wget',
      '-q',
      '-O',
      '-',
      'http://127.0.0.1:8081/maintenance',
    ]);
    assert.equal(text, expected ? 'enabled' : 'disabled');
  };
  const stop = async () => {
    // Cleanup ignores cancellation, but remains bounded and only addresses owned services.
    const value = state.current ?? selected;
    await compose(value, ['stop', '--timeout', '30', 'jobs', 'api'], { timeout: 90000 });
    await assertRuntime(value, ['api', 'jobs'], true);
  };
  const markerChange = async (enabled) => {
    if (enabled) {
      let handle;
      try {
        handle = await open(marker, 'wx', 0o644);
        await handle.chmod(0o644);
        await handle.writeFile('maintenance\n');
        await handle.sync();
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const st = await lstat(marker);
        assert(
          st.isFile() &&
            !st.isSymbolicLink() &&
            st.uid === process.getuid() &&
            (st.mode & 0o777) === 0o644,
        );
      } finally {
        await handle?.close();
      }
    } else await unlink(marker);
    const dir = await open(config.maintenanceDirectory, 'r');
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  };
  try {
    const io = {
      state: async () => state,
      prepare: async (candidate, current, sourceCheck, recovery) => {
        selected = candidate;
        if (sourceCheck) {
          await currentSource(candidate.revision);
          assert.deepEqual(await sourceMigrations(), candidate.migrations);
        }
        assert.equal(await localEngine(run), candidate.platform);
        const registry = candidate.images.migration.split('/').slice(0, -1).join('/');
        auth = await registryConfiguration(env.HAEN_REGISTRY_CONFIG_FILE, work, registry);
        run = docker(signal, { ...baseEnv, DOCKER_CONFIG: auth });
        cleanup = docker(undefined, { ...baseEnv, DOCKER_CONFIG: auth });
        const version = await run(['compose', 'version', '--short']);
        const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
        assert(
          match && (Number(match[1]) > 2 || (Number(match[1]) === 2 && Number(match[2]) >= 30)),
        );
        for (const role of roles) {
          await run(['pull', candidate.images[role]], { capture: false, timeout: 900000 });
          const image = await imageIdentity(
            run,
            candidate.images[role],
            candidate.imageRevisions[role],
            candidate.platform,
          );
          if (role === 'server') assertRuntimeLogImage(image);
        }
        if (current) {
          for (const role of roles) {
            await run(['pull', current.images[role]], { capture: false, timeout: 900000 });
            await imageIdentity(
              run,
              current.images[role],
              current.imageRevisions[role],
              current.platform,
            );
          }
        }
        for (const service of ['api', 'jobs', 'web']) {
          for (const row of await instances(service)) {
            assert(Number.isSafeInteger(row.RestartCount) && row.RestartCount >= 0);
            initialRestarts.set(row.Id, row.RestartCount);
          }
        }
        if (current && !recovery) await assertRuntime(current, ['api', 'jobs', 'web']);
        else
          for (const service of ['api', 'jobs', 'web']) {
            const rows = await instances(service);
            if (!recovery) assert.equal(rows.length, 0);
            else if (rows.length) {
              const role = service === 'web' ? 'web' : 'server';
              const allowed = [current, state.attempt.candidate].filter(Boolean);
              const ids = await Promise.all(
                allowed.map((value) =>
                  imageIdentity(
                    run,
                    value.images[role],
                    value.imageRevisions[role],
                    value.platform,
                  ).then((image) => image.Id),
                ),
              );
              assert(ids.includes(rows[0].Image));
            }
          }
        const tools = await instances('migration');
        assert(tools.every((row) => !row.State.Running));
        try {
          await lstat(marker);
          assert(recovery);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        // Validate without printing expanded Compose configuration or secret env values.
        await compose(candidate, ['config', '--quiet']);
      },
      status: async (value) =>
        JSON.parse(
          await compose(value, ['run', '--rm', '--no-deps', '--no-TTY', 'migration', 'status']),
        ),
      begin: async (_prior, attempt) => {
        for (const record of [state.lastCompleted, state.attempt].filter(Boolean)) {
          assert(/^[a-f0-9]{24}$/.test(record.id));
          const path = join(config.stateDirectory, record.id + '.json');
          try {
            await save(path, record);
          } catch (error) {
            if (error.code !== 'EEXIST') throw error;
            assert.deepEqual(await load(path), record);
          }
        }
        state = { ...state, attempt };
        await replaceState(statePath, state);
      },
      phase: async (phase, extra = {}) => {
        state.attempt = { ...state.attempt, ...extra, phase };
        await replaceState(statePath, state);
      },
      maintenance: markerChange,
      checkMaintenance: probe,
      stop,
      backup: async (revision) => {
        const result = JSON.parse(
          await command(
            '/usr/bin/sudo',
            [
              '--non-interactive',
              '/usr/local/libexec/haen-pre-migration',
              'pre-migration',
              revision,
              targetFingerprint,
            ],
            { signal, timeout: 900000, env: { PATH: '/usr/bin:/bin' } },
          ),
        );
        assert(result.event === 'pre_migration_backup_verified');
        return result.id;
      },
      migrate: async (value, empty) => {
        const result = JSON.parse(
          await compose(value, [
            'run',
            '--rm',
            '--no-deps',
            '--no-TTY',
            '-e',
            'MIGRATION_WRITES_STOPPED=true',
            '-e',
            'MIGRATION_INITIALIZE_EMPTY=' + String(empty),
            'migration',
          ]),
        );
        assert(result.event === 'migration_completed');
      },
      catalog: async (value) => {
        const query = () =>
          compose(value, [
            'run',
            '--rm',
            '--no-deps',
            '--no-TTY',
            'jobs',
            'dist/entrypoints/catalog.js',
            'status',
          ]);
        const first = JSON.parse(await query());
        if (first.status !== 'ready') {
          assert(
            env.HAEN_BOOTSTRAP_CATALOG === 'true' && env.HAEN_OTHER_WRITERS_STOPPED === 'true',
          );
          await compose(
            value,
            ['run', '--rm', '--no-deps', '--no-TTY', 'jobs', 'dist/entrypoints/catalog.js', 'sync'],
            { capture: false, timeout: 900000 },
          );
          assert(JSON.parse(await query()).status === 'ready');
        }
      },
      api: async (value) => {
        await compose(
          value,
          [
            'up',
            '--detach',
            '--no-deps',
            '--force-recreate',
            '--wait',
            '--wait-timeout',
            '120',
            'api',
          ],
          { timeout: 150000 },
        );
        await assertRuntime(value, ['api']);
      },
      web: async (value) => {
        await compose(
          value,
          [
            'up',
            '--detach',
            '--no-deps',
            '--force-recreate',
            '--wait',
            '--wait-timeout',
            '120',
            'web',
          ],
          { timeout: 150000 },
        );
        await assertRuntime(value, ['web']);
      },
      checkWeb: async (value) => {
        await compose(value, [
          'exec',
          '--no-TTY',
          'web',
          'wget',
          '-q',
          '-O',
          '/dev/null',
          'http://127.0.0.1:8081/api/v1/health/ready',
        ]);
        const html = await compose(value, [
          'exec',
          '--no-TTY',
          'web',
          'wget',
          '-q',
          '-O',
          '-',
          'http://127.0.0.1:8081/release',
        ]);
        const asset = /(?:src|href)="(\/assets\/[A-Za-z0-9_.-]+\.js)"/.exec(html)?.[1];
        assert(asset);
        await compose(value, [
          'exec',
          '--no-TTY',
          'web',
          'wget',
          '-q',
          '-O',
          '/dev/null',
          'http://127.0.0.1:8081' + asset,
        ]);
      },
      jobs: async (value) => {
        await compose(value, ['up', '--detach', '--no-deps', '--force-recreate', 'jobs']);
        for (let attempt = 0; attempt < 30; attempt++) {
          signal.throwIfAborted();
          const rows = await instances('jobs');
          assert.equal(rows.length, 1);
          assert(rows[0].State.Running && rows[0].RestartCount === 0);
          const started = Date.parse(rows[0].State.StartedAt);
          assert(Number.isSafeInteger(started));
          try {
            assert.equal(
              await run([
                'exec',
                rows[0].Id,
                'node',
                '--input-type=module',
                '-e',
                runtimeLogProbe('jobs', value.imageRevisions.server, 'scheduler_started', started),
              ]),
              'ready',
            );
            await assertRuntime(value, ['jobs']);
            return;
          } catch {
            signal.throwIfAborted();
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        throw Error('Scheduler did not become ready');
      },
      checkRuntime: (value) => assertRuntime(value, ['api', 'web', 'jobs']),
      activate: async (current, previous) => {
        const recorded = JSON.parse(
          await command(
            '/usr/bin/sudo',
            [
              '--non-interactive',
              '/usr/local/libexec/haen-pre-migration',
              'record-revision',
              current.imageRevisions.server,
              targetFingerprint,
            ],
            { signal, env: { PATH: '/usr/bin:/bin' } },
          ),
        );
        assert(recorded.event === 'backup_revision_recorded');
        state = { ...state, current, previous };
        await replaceState(statePath, state);
      },
      checkPublic: async () => {
        const response = await fetch(config.site + '/api/v1/health/ready', {
          signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
          redirect: 'error',
        });
        assert(response.ok);
        await response.body?.cancel();
        const page = await fetch(config.site, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
          redirect: 'error',
        });
        assert(page.ok && page.headers.get('content-type')?.includes('text/html'));
        await page.body?.cancel();
      },
      finish: async () => {
        const finished = {
          ...state,
          lastCompleted: {
            ...state.attempt,
            phase: 'completed',
            finishedAt: new Date().toISOString(),
          },
        };
        delete finished.attempt;
        await replaceState(statePath, finished);
        state = finished;
      },
      fail: async (failedStage, cleanupConfirmed) => {
        cleanMode = true;
        state.attempt = { ...state.attempt, phase: 'failed', failedStage, cleanupConfirmed };
        await replaceState(statePath, state);
      },
    };
    // Failure cleanup must still operate after an aborted outer release lock.
    const enable = io.maintenance;
    io.maintenance = async (enabled) => {
      if (signal.aborted) cleanMode = true;
      return enable(enabled);
    };
    return await deployFlow(
      {
        action,
        scope,
        release,
        initializeEmpty: env.MIGRATION_INITIALIZE_EMPTY === 'true',
        otherWritersStopped: env.HAEN_OTHER_WRITERS_STOPPED === 'true',
        compatibilityConfirmed: env.HAEN_CONTRACT_COMPATIBILITY_CONFIRMED === 'true',
        recoveryConfirmed: env.HAEN_RECOVERY_CONFIRMED === 'true',
        recoveryVersion: env.HAEN_RECOVERY_VERSION,
        baselineRevision: env.HAEN_BASELINE_REVISION,
      },
      io,
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
