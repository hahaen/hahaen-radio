import { it, expect } from 'vitest';
import { mkdtemp, rm, readdir, mkdir, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deployFlow } from '../scripts/flow.mjs';
import { replaceState, targetConfiguration } from '../scripts/target.mjs';
import { load } from '../scripts/release/common.mjs';
const migration = (n) => ({ file: `000${n}_migration.sql`, sha256: String(n).repeat(64) });
const release = (revision = 'a', count = 2) => ({
  format: 1,
  revision: revision.repeat(40),
  platform: 'linux/amd64',
  imageCheckRun: 'a'.repeat(12),
  images: Object.fromEntries(
    ['web', 'server', 'migration'].map((role) => [
      role,
      `registry.example.test/haen/${role}@sha256:${revision.repeat(64)}`,
    ]),
  ),
  migrations: Array.from({ length: count }, (_, i) => migration(i)),
});
const installed = (revision = 'a', count = 2) => ({
  ...release(revision, count),
  imageRevisions: Object.fromEntries(
    ['web', 'server', 'migration'].map((role) => [role, revision.repeat(40)]),
  ),
});
function fixture(current = installed('b', 1), fail) {
  let state = { format: 1, current },
    pending = current ? 1 : 2;
  const events = [],
    snapshots = [];
  const call = async (name, ...args) => {
    events.push([name, ...args]);
    if (name === fail) throw Error('private failure');
  };
  const io = {
    state: async () => structuredClone(state),
    prepare: (...args) => call('prepare', ...args),
    status: async (candidate) => {
      await call('status');
      const expected = candidate.migrations.map((m) => ({ file: m.file, hash: m.sha256 }));
      return {
        event: 'migration_status',
        empty: !state.current,
        tables: 2,
        expected,
        applied: expected.slice(0, expected.length - pending),
        pending: expected.slice(expected.length - pending),
      };
    },
    begin: async (_state, attempt) => {
      await call('begin');
      state.attempt = attempt;
    },
    phase: async (phase, extra = {}) => {
      state.attempt = { ...state.attempt, ...extra, phase };
      snapshots.push(structuredClone(state));
    },
    maintenance: (value) => call('maintenance', value),
    checkMaintenance: (value) => call('probe', value),
    web: () => call('web'),
    stop: () => call('stop'),
    backup: async () => {
      await call('backup');
      return 'haen-20261017T000000000Z-aaaaaaaaaaaa';
    },
    migrate: async () => {
      await call('migrate');
      pending = 0;
      state.current ??= installed('a');
    },
    catalog: () => call('catalog'),
    api: () => call('api'),
    checkWeb: () => call('checkWeb'),
    jobs: () => call('jobs'),
    checkRuntime: () => call('runtime'),
    checkPublic: () => call('public'),
    activate: async (candidate, previous) => {
      await call('activate');
      state.current = candidate;
      state.previous = previous;
    },
    finish: async () => {
      await call('finish');
      delete state.attempt;
    },
    fail: async (stage, cleanupConfirmed) => {
      state.attempt = { ...state.attempt, phase: 'failed', failedStage: stage, cleanupConfirmed };
    },
  };
  return {
    io,
    events,
    snapshots,
    state: () => state,
    setPending: (n) => {
      pending = n;
    },
    setState: (value) => {
      state = value;
    },
  };
}
it('backs up before SQL, starts API then web then jobs, records before public activation and persists no credentials', async () => {
  const f = fixture();
  await deployFlow(
    { action: 'apply', scope: 'full', release: release(), otherWritersStopped: true },
    f.io,
  );
  const names = f.events.map((e) => e[0]);
  expect(names.indexOf('stop')).toBeLessThan(names.indexOf('backup'));
  expect(names.indexOf('backup')).toBeLessThan(names.indexOf('migrate'));
  expect(names.indexOf('migrate')).toBeLessThan(names.indexOf('api'));
  expect(names.indexOf('api')).toBeLessThan(names.lastIndexOf('web'));
  expect(names.lastIndexOf('web')).toBeLessThan(names.indexOf('jobs'));
  expect(names.indexOf('activate')).toBeLessThan(names.indexOf('public'));
  expect(f.snapshots.find((s) => s.attempt.phase === 'migration').attempt.backupId).toBe(
    'haen-20261017T000000000Z-aaaaaaaaaaaa',
  );
  expect(f.state().attempt).toBeUndefined();
});
it('retains a failed migration attempt and backup, stops writers, and refuses a normal retry', async () => {
  const f = fixture(undefined, 'migrate');
  f.setState({ format: 1, current: installed('b', 1) });
  f.setPending(1);
  await expect(
    deployFlow(
      { action: 'apply', scope: 'full', release: release(), otherWritersStopped: true },
      f.io,
    ),
  ).rejects.toThrow('Target release failed');
  expect(f.state().attempt).toMatchObject({
    phase: 'failed',
    failedStage: 'migration',
    backupId: 'haen-20261017T000000000Z-aaaaaaaaaaaa',
    cleanupConfirmed: true,
  });
  expect(f.events.filter((e) => e[0] === 'stop')).toHaveLength(2);
  await expect(
    deployFlow(
      { action: 'apply', scope: 'full', release: release(), otherWritersStopped: true },
      f.io,
    ),
  ).rejects.toThrow();
  expect(f.events.filter((e) => e[0] === 'migrate')).toHaveLength(1);
});
it('requires empty initialization and split-release confirmation; a web update preserves server and never runs SQL', async () => {
  const fresh = fixture();
  fresh.setState({ format: 1 });
  fresh.setPending(2);
  await expect(
    deployFlow(
      { action: 'apply', scope: 'full', release: release(), otherWritersStopped: true },
      fresh.io,
    ),
  ).rejects.toThrow();
  expect(fresh.events.some((e) => e[0] === 'begin')).toBe(false);
  const f = fixture(installed('b', 2));
  f.setPending(0);
  await expect(
    deployFlow({ action: 'apply', scope: 'web', release: release() }, f.io),
  ).rejects.toThrow();
  await deployFlow(
    { action: 'apply', scope: 'web', release: release(), compatibilityConfirmed: true },
    f.io,
  );
  expect(f.state().current.imageRevisions).toEqual({
    web: 'a'.repeat(40),
    server: 'b'.repeat(40),
    migration: 'b'.repeat(40),
  });
  expect(
    f.events.filter((e) => ['migrate', 'backup', 'stop', 'api', 'jobs'].includes(e[0])),
  ).toEqual([]);
});
it('refuses a rollback across a changed database and allows an explicit completed candidate recovery without SQL', async () => {
  const f = fixture(installed('a', 2));
  f.setState({ format: 1, current: installed('a', 2), previous: installed('b', 1) });
  await expect(
    deployFlow({ action: 'rollback', scope: 'full', compatibilityConfirmed: true }, f.io),
  ).rejects.toThrow();
  expect(f.events).toEqual([]);
  f.setState({
    format: 1,
    current: installed('b', 1),
    attempt: { phase: 'migration', candidate: installed('a', 2) },
  });
  f.setPending(0);
  await expect(
    deployFlow({ action: 'recover', scope: 'full', recoveryVersion: 'attempt' }, f.io),
  ).rejects.toThrow();
  await deployFlow(
    { action: 'recover', scope: 'full', recoveryVersion: 'attempt', recoveryConfirmed: true },
    f.io,
  );
  expect(f.events.some((e) => e[0] === 'migrate')).toBe(false);
  expect(f.state().current.revision).toBe('a'.repeat(40));
});
it('refuses SQL after backup failure and preserves an unconfirmed cleanup for operators', async () => {
  const f = fixture(undefined, 'backup');
  f.io.stop = async () => {
    f.events.push(['stop']);
    if (f.events.some((e) => e[0] === 'backup')) throw Error('Cannot stop');
  };
  await expect(
    deployFlow(
      { action: 'apply', scope: 'full', release: release(), otherWritersStopped: true },
      f.io,
    ),
  ).rejects.toThrow();
  expect(f.events.some((e) => e[0] === 'migrate')).toBe(false);
  expect(f.state().attempt).toMatchObject({
    phase: 'failed',
    failedStage: 'backup',
    cleanupConfirmed: false,
  });
});
it('publishes whole private state files atomically and leaves no pending artifact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haen-target-state-')),
    path = join(root, 'state.json');
  try {
    await replaceState(path, { format: 1, attempt: { phase: 'migration' } });
    expect(await load(path)).toEqual({ format: 1, attempt: { phase: 'migration' } });
    await replaceState(path, { format: 1, current: installed() });
    expect((await load(path)).current.revision).toBe('a'.repeat(40));
    expect(await readdir(root)).toEqual(['state.json']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('preserves the old web on a server release and rolls back an explicitly compatible unchanged database', async () => {
  const server = fixture();
  await deployFlow(
    {
      action: 'apply',
      scope: 'server',
      release: release(),
      compatibilityConfirmed: true,
      otherWritersStopped: true,
    },
    server.io,
  );
  expect(server.state().current.imageRevisions).toEqual({
    web: 'b'.repeat(40),
    server: 'a'.repeat(40),
    migration: 'a'.repeat(40),
  });
  const back = fixture(installed('a', 2));
  back.setPending(0);
  back.setState({ format: 1, current: installed('a', 2), previous: installed('b', 2) });
  await deployFlow({ action: 'rollback', scope: 'full', compatibilityConfirmed: true }, back.io);
  expect(back.state().current.revision).toBe('b'.repeat(40));
  expect(back.events.some((e) => ['migrate', 'backup'].includes(e[0]))).toBe(false);
});

it('validates private raw config against the actual target and refuses quoted hosts or shared marker/state directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haen-target-config-'));
  try {
    const marker = join(root, 'markers'),
      state = join(root, 'state'),
      ca = join(root, 'ca.pem'),
      target = join(root, 'target.json');
    await mkdir(marker, { mode: 0o755 });
    await chmod(marker, 0o755);
    await mkdir(state, { mode: 0o700 });
    await writeFile(ca, 'public-ca', { mode: 0o644 });
    const config = {
      format: 1,
      environment: 'production',
      site: 'https://radio.example.test',
      apiEnvFile: join(root, 'api.env'),
      jobsEnvFile: join(root, 'jobs.env'),
      migrationEnvFile: join(root, 'migration.env'),
      databaseCaFile: ca,
      maintenanceDirectory: marker,
      stateDirectory: state,
    };
    const raw = 'DB_HOST=db.example.test\nDB_USER=fixture\nDB_PASSWORD=fixture\n';
    for (const file of [config.apiEnvFile, config.jobsEnvFile, config.migrationEnvFile])
      await writeFile(file, raw, { mode: 0o600 });
    await writeFile(target, JSON.stringify(config), { mode: 0o600 });
    const database = {
      host: 'db.example.test',
      port: 3306,
      database: 'ha_radio',
      ssl: { ca: 'public-ca', rejectUnauthorized: true, verifyIdentity: true },
    };
    expect((await targetConfiguration(target, database)).site).toBe(config.site);
    await expect(
      targetConfiguration(target, database, 'https://other.example.test'),
    ).rejects.toThrow();
    await writeFile(
      config.apiEnvFile,
      raw.replace('DB_HOST=db.example.test', 'DB_HOST="db.example.test"'),
    );
    await expect(targetConfiguration(target, database)).rejects.toThrow();
    await writeFile(config.apiEnvFile, raw);
    await writeFile(target, JSON.stringify({ ...config, stateDirectory: marker }));
    await expect(targetConfiguration(target, database)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
