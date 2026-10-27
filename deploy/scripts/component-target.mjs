import assert from 'node:assert/strict';
import { lstat, readFile, open, unlink, mkdtemp, rm, mkdir, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { docker, command, load, save, localEngine } from './release/common.mjs';
import { currentSource, sourceMigrations, imageIdentity } from './release/images.mjs';
import { targetConfiguration, replaceState, synchronizeRuntimeEnvironment } from './target.mjs';
import {
  componentFlow,
  componentRelease,
  compatibleCombination,
  webRelease,
} from './component-state.mjs';
import { pruneLocalImages, currentOnlyState } from './local-images.mjs';
import { sourceDescriptor } from './component-release.mjs';
import { prepareStaticWeb, activateStaticWeb, assertStaticWeb } from './static-web.mjs';
import { assertRuntimeLogImage, runtimeLogProbe } from './runtime-logs.mjs';
import { probePublicRelease } from './public-check.mjs';

async function configuration(env, suppliedDatabase) {
  const { readDatabaseConfig, databaseTargetFingerprint } =
    await import('../../apps/server/src/config/database.ts');
  const database = suppliedDatabase ?? readDatabaseConfig(env),
    fingerprint = databaseTargetFingerprint(database);
  assert.equal(
    fingerprint,
    env.HAEN_EXPECTED_DATABASE_FINGERPRINT || env.HAEN_TARGET_DATABASE_FINGERPRINT,
  );
  const config = await targetConfiguration(
    env.HAEN_TARGET_CONFIG_FILE,
    database,
    env.HAEN_EXPECTED_SITE || env.HAEN_TARGET_SITE,
  );
  return { config, database, fingerprint, readDatabaseConfig };
}
async function installedState(config) {
  try {
    const state = await load(join(config.stateDirectory, 'state.json'));
    assert(state.format === 2);
    return state;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { format: 2, components: {}, previous: {} };
  }
}
async function hostMigrationStatus(config, readDatabaseConfig) {
  const raw = Object.fromEntries(
    (await readFile(config.migrationEnvFile, 'utf8'))
      .split('\n')
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );
  const database = readDatabaseConfig({
    ...raw,
    NODE_ENV: 'production',
    DB_NAME: 'ha_radio',
    DB_TLS: 'required',
    DB_TLS_CA_PATH: config.databaseCaFile,
  });
  const { migrationStatus } = await import('../../apps/server/src/operations/migration-plan.ts');
  return { event: 'migration_status', ...(await migrationStatus(database)) };
}
async function storedMigrationStatus(run, config, schema) {
  await imageIdentity(run, schema.image, schema.revision, schema.platform);
  const text = await run([
    'run',
    '--rm',
    '--name',
    'radio-schema-check-' + process.pid,
    '--network',
    'radio_application',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--tmpfs',
    '/tmp:size=32m,mode=1777',
    '--env-file',
    config.migrationEnvFile,
    '-e',
    'NODE_ENV=production',
    '-e',
    'DB_NAME=ha_radio',
    '-e',
    'DB_TLS=required',
    '-e',
    'DB_TLS_CA_PATH=/run/haen/mysql-ca.pem',
    '--mount',
    'type=bind,source=' + config.databaseCaFile + ',target=/run/haen/mysql-ca.pem,readonly',
    schema.image,
    'status',
  ]);
  const result = JSON.parse(text);
  assert.deepEqual(
    result.expected.map((row) => ({ file: row.file, sha256: row.hash })),
    schema.migrations,
  );
  return result;
}
export async function planComponent(env) {
  assert.equal(process.version, 'v24.22.1');
  assert.equal(env.CI, 'true');
  const source = await sourceDescriptor(env),
    { config, readDatabaseConfig } = await configuration(env),
    state = await installedState(config);
  assert(!state.attempt, 'Resolve the persisted failed attempt before a new release');
  let status;
  if (source.component === 'frontend') {
    assert(state.schema && state.components.api, 'Publish the API before the frontend');
    status = await storedMigrationStatus(docker(undefined, env), config, state.schema);
    assert.equal(status.pending.length, 0);
  } else status = await hostMigrationStatus(config, readDatabaseConfig);
  compatibleCombination(
    state,
    source,
    status.pending.length ? source.migrations : (state.schema?.migrations ?? source.migrations),
  );
  return { empty: status.empty, pending: status.pending.length };
}
export async function executeComponentTarget(env, signal, database, targetFingerprint) {
  assert.equal(process.platform, 'linux');
  assert.equal(process.version, 'v24.22.1');
  const { config, readDatabaseConfig, fingerprint } = await configuration(env, database);
  assert.equal(fingerprint, targetFingerprint);
  const action = env.HAEN_DEPLOY_ACTION || 'apply',
    component = env.HAEN_DEPLOY_SCOPE;
  const release =
    action === 'apply' ? componentRelease(await load(env.HAEN_RELEASE_FILE)) : undefined;
  let state = await installedState(config),
    cleanMode = false,
    activeAttempt = state.attempt;
  if (action === 'apply') {
    assert(!state.attempt, 'Resolve failed attempt first');
    await synchronizeRuntimeEnvironment(env);
  }
  const statePath = join(config.stateDirectory, 'state.json'),
    marker = join(config.maintenanceDirectory, 'enabled'),
    work = await mkdtemp(join(config.stateDirectory, '.component-'));
  const run = docker(signal, env),
    cleanup = docker(undefined, env);
  const invoke = (args, options) => (cleanMode ? cleanup : run)(args, options);
  const retired = [];
  const persist = () => replaceState(statePath, state);
  const instances = async (role) => {
    const owned = (
      await invoke([
        'ps',
        '-aq',
        '--filter',
        'label=com.docker.compose.project=radio',
        '--filter',
        'label=com.docker.compose.service=' + role,
      ])
    )
      .split(/\s+/)
      .filter(Boolean);
    const named = (await invoke(['ps', '-aq', '--filter', 'name=^/radio-' + role + '$']))
      .split(/\s+/)
      .filter(Boolean);
    const ids = [...new Set([...owned, ...named])];
    assert(ids.length <= 1);
    if (!ids.length) return [];
    assert(ids.every((id) => /^[a-f0-9]{12,64}$/.test(id)));
    const rows = JSON.parse(await invoke(['inspect', ...ids]));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].Name, '/radio-' + role);
    assert.equal(rows[0].Config.Labels['com.docker.compose.project'], 'radio');
    assert.equal(rows[0].Config.Labels['com.docker.compose.service'], role);
    return rows;
  };
  const environmentPath = (value) =>
    join(
      config.stateDirectory,
      'environments',
      value.component + '-' + value.validationRun + '.env',
    );
  const preserveEnvironment = async (value, create) => {
    if (value.component === 'frontend') return;
    const directory = join(config.stateDirectory, 'environments');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = environmentPath(value),
      runtime = value.component === 'api' ? config.apiEnvFile : config.jobsEnvFile;
    if (create) {
      const fd = await open(file, 'wx', 0o600);
      try {
        await fd.writeFile(await readFile(runtime));
        await fd.sync();
      } finally {
        await fd.close();
      }
    } else {
      const st = await lstat(file);
      assert(
        st.isFile() &&
          !st.isSymbolicLink() &&
          st.nlink === 1 &&
          st.uid === process.getuid() &&
          (st.mode & 0o777) === 0o600,
      );
      await copyFile(file, runtime);
    }
  };
  const tool = (value) => value.migrationImage || state.schema?.image;
  const compose = async (value, args, options) => {
    const server =
      value.component === 'frontend'
        ? state.components.api?.image || state.components.jobs?.image
        : value.image;
    const variables = {
      HAEN_SERVER_IMAGE: server,
      HAEN_MIGRATION_IMAGE: tool(value),
      HAEN_DB_CA_FILE: config.databaseCaFile,
      HAEN_API_ENV_FILE: config.apiEnvFile,
      HAEN_JOBS_ENV_FILE: config.jobsEnvFile,
      HAEN_MIGRATION_ENV_FILE: config.migrationEnvFile,
    };
    assert(variables.HAEN_SERVER_IMAGE && variables.HAEN_MIGRATION_IMAGE);
    const file = join(work, 'compose.env'),
      fd = await open(file, 'w', 0o600);
    try {
      await fd.writeFile(
        Object.entries(variables)
          .map(([k, v]) => k + '=' + v)
          .join('\n') + '\n',
      );
    } finally {
      await fd.close();
    }
    return invoke(
      [
        'compose',
        '--project-name',
        'radio',
        '--env-file',
        file,
        '--file',
        resolve('deploy/compose/compose.yaml'),
        ...args,
      ],
      options,
    );
  };
  const gateway = (path) =>
    invoke(['exec', 'nginx', 'wget', '-q', '-T', '5', '-O', '-', 'http://127.0.0.1:8089' + path]);
  const verify = async (value) => {
    if (value.component === 'frontend') {
      await assertStaticWeb(webRelease(value), config);
      assert.equal(
        await gateway('/release'),
        (await readFile(join(config.staticDirectory, 'current/index.html'), 'utf8')).trim(),
      );
      return;
    }
    const rows = await instances(value.component);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(
      row.Image,
      (await imageIdentity(invoke, value.image, value.revision, value.platform)).Id,
    );
    assert(row.State.Running && !row.State.Restarting && row.RestartCount === 0);
    if (value.component === 'api') assert.equal(row.State.Health?.Status, 'healthy');
    else {
      const started = Date.parse(row.State.StartedAt);
      assert(Number.isSafeInteger(started));
      assert.equal(
        await invoke([
          'exec',
          row.Id,
          'node',
          '--input-type=module',
          '-e',
          runtimeLogProbe('jobs', value.revision, 'scheduler_started', started),
        ]),
        'ready',
      );
    }
  };
  const stop = async (roles) => {
    for (const role of roles) {
      const rows = await instances(role);
      if (!rows.length) continue;
      await invoke(['stop', '--time', '30', rows[0].Id], { timeout: 90000 });
      assert((await instances(role)).every((row) => !row.State.Running));
    }
  };
  const maintenance = async (enabled) => {
    if (signal.aborted) cleanMode = true;
    if (enabled) {
      let fd;
      try {
        fd = await open(marker, 'wx', 0o644);
        await fd.chmod(0o644);
        await fd.writeFile('maintenance\n');
        await fd.sync();
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const st = await lstat(marker);
        assert(
          st.isFile() &&
            !st.isSymbolicLink() &&
            st.nlink === 1 &&
            st.uid === process.getuid() &&
            (st.mode & 0o777) === 0o644,
        );
      } finally {
        await fd?.close();
      }
    } else await unlink(marker);
    const directory = await open(config.maintenanceDirectory, 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  };

  const recordPrimaryRevision = async (value) => {
    const primary = value.components.api ?? value.components.jobs;
    if (primary && (component === 'api' || (component === 'jobs' && !value.components.api))) {
      const recorded = JSON.parse(
        await command(
          '/usr/bin/sudo',
          [
            '--non-interactive',
            '/usr/local/libexec/haen-pre-migration',
            'record-revision',
            primary.revision,
            targetFingerprint,
          ],
          { signal, env: { PATH: '/usr/bin:/bin' } },
        ),
      );
      assert.equal(recorded.event, 'backup_revision_recorded');
    }
  };

  try {
    const io = {
      state: async () => state,
      prepare: async (candidate, sourceCheck, recovery) => {
        if (sourceCheck) {
          await currentSource(candidate.revision);
          assert.deepEqual(candidate.migrations, await sourceMigrations());
        }
        await preserveEnvironment(candidate, sourceCheck);
        assert.equal(await localEngine(run), candidate.platform);
        for (const reference of [candidate.image, candidate.migrationImage].filter(Boolean)) {
          const image = await imageIdentity(run, reference, candidate.revision, candidate.platform);
          if (reference === candidate.image && candidate.component !== 'frontend')
            assertRuntimeLogImage(image);
          if (candidate.component === 'frontend')
            assert.equal(image.Config.Labels['io.haen.web-base'], '/radio/');
        }
        for (const value of Object.values(state.components)) {
          if (recovery && value.component !== 'frontend') {
            if (value.component === component) continue;
            const rows = await instances(value.component);
            assert.equal(rows.length, 1);
            assert.equal(
              rows[0].Image,
              (await imageIdentity(invoke, value.image, value.revision, value.platform)).Id,
            );
          } else if (!(recovery && value.component === component)) await verify(value);
        }
        if (component !== 'frontend' && !state.components[component] && !recovery)
          assert.equal((await instances(component)).length, 0);
        if (component !== 'frontend' && recovery)
          for (const row of await instances(component)) {
            const allowed = [
              state.components[component],
              state.previous[component],
              state.attempt.candidate,
            ].filter(Boolean);
            const ids = [];
            for (const value of allowed)
              ids.push(
                (await imageIdentity(invoke, value.image, value.revision, value.platform)).Id,
              );
            assert(ids.includes(row.Image));
          }
        const shared = JSON.parse(await invoke(['inspect', 'nginx']))[0];
        assert(shared.State.Running && shared.NetworkSettings.Networks.radio_application);
        for (const [destination, source] of [
          ['/srv/radio', config.staticDirectory],
          ['/srv/radio-maintenance', config.maintenanceDirectory],
        ]) {
          const mount = shared.Mounts.find((row) => row.Destination === destination);
          assert(mount && mount.Type === 'bind' && mount.Source === source && mount.RW === false);
        }
        assert.equal((await invoke(['ps', '-aq', '--filter', 'name=^/radio-web$'])).trim(), '');
        if (candidate.component === 'frontend')
          await prepareStaticWeb(invoke, webRelease(candidate), config, (...args) =>
            cleanup(...args),
          );
        try {
          await lstat(marker);
          assert(recovery);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      },
      status: async (candidate) =>
        candidate.component === 'frontend'
          ? storedMigrationStatus(invoke, config, state.schema)
          : hostMigrationStatus(config, readDatabaseConfig),
      begin: async (attempt) => {
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
        activeAttempt = attempt;
        await persist();
      },
      phase: async (phase) => {
        state.attempt = { ...state.attempt, phase };
        activeAttempt = state.attempt;
        await persist();
      },
      maintenance,
      checkMaintenance: async (enabled) =>
        assert.equal(await gateway('/maintenance'), enabled ? 'enabled' : 'disabled'),
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
        assert.equal(result.event, 'pre_migration_backup_verified');
        state.attempt.backupId = result.id;
        await persist();
      },
      migrate: async (candidate, empty) => {
        const result = JSON.parse(
          await compose(candidate, [
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
        assert.equal(result.event, 'migration_completed');
      },
      recordSchema: async (candidate) => {
        state = {
          ...state,
          schema: {
            image: candidate.migrationImage,
            revision: candidate.revision,
            platform: candidate.platform,
            migrations: candidate.migrations,
          },
        };
        await persist();
      },
      catalog: async (candidate) => {
        const query = async () =>
          JSON.parse(
            await compose(candidate, [
              'run',
              '--rm',
              '--no-deps',
              '--no-TTY',
              'jobs',
              'dist/entrypoints/catalog.js',
              'status',
            ]),
          );
        if ((await query()).status !== 'ready') {
          assert(
            env.HAEN_BOOTSTRAP_CATALOG === 'true' && env.HAEN_OTHER_WRITERS_STOPPED === 'true',
          );
          await compose(
            candidate,
            ['run', '--rm', '--no-deps', '--no-TTY', 'jobs', 'dist/entrypoints/catalog.js', 'sync'],
            { capture: false, timeout: 900000 },
          );
          assert.equal((await query()).status, 'ready');
        }
      },
      publish: async (candidate) => {
        if (candidate.component === 'frontend') {
          await activateStaticWeb(invoke, webRelease(candidate), config, (...args) =>
            cleanup(...args),
          );
          return;
        }
        await preserveEnvironment(candidate, false);
        await compose(
          candidate,
          [
            'up',
            '--detach',
            '--no-deps',
            '--force-recreate',
            '--pull',
            'never',
            '--no-build',
            ...(candidate.component === 'api' ? ['--wait', '--wait-timeout', '120'] : []),
            candidate.component,
          ],
          { timeout: 150000 },
        );
        for (let attempt = 0; ; attempt++) {
          signal.throwIfAborted();
          try {
            await verify(candidate);
            break;
          } catch {
            if (attempt >= 29) throw Error('Component readiness failed');
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      },
      verify,
      activate: async (candidate) => {
        const previous = state.components[component];
        if (state.previous[component]) retired.push(state.previous[component]);
        state = {
          ...state,
          components: { ...state.components, [component]: candidate },
          previous: { ...state.previous, [component]: previous },
        };
        await persist();
      },
      public: async (candidate) => {
        if (candidate.component === 'jobs' && !state.components.api) return;
        const html = state.components.frontend
          ? await readFile(join(config.staticDirectory, 'current/index.html'), 'utf8')
          : null;
        for (let attempt = 0; ; attempt++) {
          signal.throwIfAborted();
          try {
            await probePublicRelease(config.site, html, signal);
            break;
          } catch {
            if (attempt >= 14) throw Error('Public readiness failed');
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      },
      finish: async () => {
        await recordPrimaryRevision(state);
        const completed = currentOnlyState(state, component);
        retired.push(...completed.retired);
        state = {
          ...completed.state,
          lastCompleted: {
            ...state.attempt,
            phase: 'completed',
            finishedAt: new Date().toISOString(),
          },
        };
        delete state.attempt;
        await persist();
        try {
          await pruneLocalImages(invoke, state, config, retired);
        } catch {
          console.error(JSON.stringify({ event: 'local_image_cleanup_incomplete' }));
        }
      },
      restore: async (original, failedStage) => {
        await recordPrimaryRevision(original);
        const failed = state.attempt ?? activeAttempt;
        state = {
          ...original,
          lastFailure: {
            id: failed.id,
            component,
            revision: failed.candidate.revision,
            failedStage,
            restored: true,
            finishedAt: new Date().toISOString(),
          },
        };
        await persist();
        try {
          await pruneLocalImages(invoke, state, config, [failed.candidate]);
        } catch {
          console.error(JSON.stringify({ event: 'local_image_cleanup_incomplete' }));
        }
        console.info(JSON.stringify({ event: 'component_release_restored', component }));
      },
      fail: async (failedStage, cleanupConfirmed) => {
        cleanMode = true;
        state.attempt = {
          ...(state.attempt ?? activeAttempt),
          phase: 'failed',
          failedStage,
          cleanupConfirmed,
        };
        await persist();
      },
    };
    return await componentFlow(
      {
        component,
        action,
        release,
        initializeEmpty: env.MIGRATION_INITIALIZE_EMPTY === 'true',
        otherWritersStopped: env.HAEN_OTHER_WRITERS_STOPPED === 'true',
        compatibilityConfirmed: env.HAEN_CONTRACT_COMPATIBILITY_CONFIRMED === 'true',
        recoveryConfirmed: env.HAEN_RECOVERY_CONFIRMED === 'true',
        recoveryVersion: env.HAEN_RECOVERY_VERSION,
        canRestore: () => !signal.aborted,
      },
      io,
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
