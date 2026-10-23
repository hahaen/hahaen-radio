import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { componentFlow, componentRelease, schemaHash } from '../scripts/component-state.mjs';
import { sourceMigrations } from '../scripts/release/images.mjs';
const policy = JSON.parse(readFileSync(new URL('../compatibility/policy.json', import.meta.url)));
const installedContract = 'a371c03455a214cc8addabd4b806a007ba37db0d2706ab96efb2e34484e8b552';
const migrations = (letter = 'a') => [{ file: '0000_initial.sql', sha256: letter.repeat(64) }];
const release = (component, letter = 'a', extra = {}) => ({
  format: 2,
  component,
  revision: letter.repeat(40),
  platform: 'linux/amd64',
  image: 'registry.example/radio/' + component + '@sha256:' + letter.repeat(64),
  migrationImage:
    component === 'frontend'
      ? null
      : 'registry.example/radio/migration@sha256:' + letter.repeat(64),
  migrations: migrations(),
  contractHash: 'a'.repeat(64),
  compatibleContracts: [],
  compatibleSchemas: [],
  validationRun: letter.repeat(12),
  ...extra,
});
function fixture({ empty = false, pending = 0, fail, state: supplied } = {}) {
  const state = supplied ?? {
    format: 2,
    components: empty
      ? {}
      : { api: release('api'), jobs: release('jobs'), frontend: release('frontend') },
    previous: {},
    ...(empty ? {} : { schema: { migrations: migrations() } }),
  };
  const events = [];
  const reject = (name, args) => {
    if (typeof fail === 'function' ? fail(name, args) : name === fail)
      throw Error('injected failure');
  };
  let count = pending,
    isEmpty = empty;
  const io = Object.fromEntries(
    [
      'prepare',
      'phase',
      'maintenance',
      'checkMaintenance',
      'stop',
      'backup',
      'catalog',
      'publish',
      'verify',
      'public',
    ].map((name) => [
      name,
      async (...args) => {
        events.push([name, ...args]);
        reject(name, args);
      },
    ]),
  );
  Object.assign(io, {
    state: async () => structuredClone(state),
    status: async () => ({
      event: 'migration_status',
      empty: isEmpty,
      applied: count ? [] : migrations(),
      pending: Array.from({ length: count }, () => ({})),
    }),
    begin: async (attempt) => {
      events.push(['begin']);
      state.attempt = attempt;
    },
    migrate: async () => {
      events.push(['migrate']);
      if (fail === 'migrate') throw Error('DDL failed');
      count = 0;
      isEmpty = false;
    },
    recordSchema: async (candidate) => {
      state.schema = { migrations: candidate.migrations };
    },
    activate: async (candidate) => {
      state.previous[candidate.component] = state.components[candidate.component];
      state.components[candidate.component] = candidate;
    },
    finish: async () => {
      delete state.attempt;
      reject('finish', []);
    },
    restore: async (original, failedStage) => {
      events.push(['restore', failedStage]);
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, structuredClone(original));
    },
    fail: async (stage, cleanupConfirmed) => {
      state.attempt = { ...state.attempt, phase: 'failed', failedStage: stage, cleanupConfirmed };
    },
  });
  return { state, events, io };
}
it.each(['frontend', 'api', 'jobs'])(
  'updates only %s and preserves the exact other component versions',
  async (component) => {
    const f = fixture(),
      before = structuredClone(f.state.components),
      next = release(component, 'b');
    await componentFlow({ component, release: next }, f.io);
    expect(f.state.components[component]).toEqual(next);
    for (const name of Object.keys(before))
      if (name !== component) expect(f.state.components[name]).toEqual(before[name]);
    expect(
      f.events.filter(([name]) => name === 'publish').map(([, value]) => value.component),
    ).toEqual([component]);
    expect(f.events.some(([name]) => ['migrate', 'backup'].includes(name))).toBe(false);
    expect(f.events.filter(([name]) => name === 'stop').map(([, roles]) => roles)).toEqual(
      component === 'frontend' ? [] : [[component]],
    );
  },
);
it('initializes an explicitly authorized empty database exactly once', async () => {
  const f = fixture({ empty: true, pending: 1 });
  await componentFlow(
    { component: 'api', release: release('api'), initializeEmpty: true, otherWritersStopped: true },
    f.io,
  );
  expect(f.events.filter(([name]) => name === 'migrate')).toHaveLength(1);
  expect(f.events.some(([name]) => name === 'backup')).toBe(false);
});
it('blocks undeclared mixed schema or contract versions before maintenance', async () => {
  for (const extra of [{ migrations: migrations('b') }, { contractHash: 'b'.repeat(64) }]) {
    const f = fixture({ pending: extra.migrations ? 1 : 0 });
    await expect(
      componentFlow(
        { component: 'api', release: release('api', 'b', extra), otherWritersStopped: true },
        f.io,
      ),
    ).rejects.toThrow();
    expect(f.events.some(([name]) => name === 'begin')).toBe(false);
  }
});
it.each([
  ['api', 'jobs', 'frontend'],
  ['api', 'frontend', 'jobs'],
  ['jobs', 'api', 'frontend'],
  ['jobs', 'frontend', 'api'],
  ['frontend', 'api', 'jobs'],
  ['frontend', 'jobs', 'api'],
])('permits the reviewed contract window in update order %s, %s, %s', async (...order) => {
  const f = fixture();
  for (const value of Object.values(f.state.components)) value.contractHash = installedContract;
  for (const component of order) {
    const before = structuredClone(f.state.components);
    await componentFlow(
      {
        component,
        release: release(component, 'b', {
          contractHash: 'b'.repeat(64),
          compatibleContracts: policy.compatibleContracts,
        }),
      },
      f.io,
    );
    for (const name of Object.keys(before))
      if (name !== component) expect(f.state.components[name]).toEqual(before[name]);
  }
  expect(f.events.some(([name]) => ['migrate', 'backup'].includes(name))).toBe(false);
  expect(f.state.attempt).toBeUndefined();
});
it('keeps unknown contracts and schema changes blocked with the reviewed policy', async () => {
  for (const extra of [
    { contractHash: 'c'.repeat(64) },
    { contractHash: installedContract, migrations: migrations('c') },
  ]) {
    const f = fixture();
    for (const value of Object.values(f.state.components)) Object.assign(value, extra);
    await expect(
      componentFlow(
        {
          component: 'api',
          release: release('api', 'b', {
            contractHash: 'b'.repeat(64),
            compatibleContracts: policy.compatibleContracts,
            compatibleSchemas: policy.compatibleSchemas,
          }),
        },
        f.io,
      ),
    ).rejects.toThrow();
    expect(f.events.some(([name]) => ['begin', 'maintenance', 'publish'].includes(name))).toBe(
      false,
    );
  }
});
it('publishes the account API then frontend after SQL without updating the legacy jobs', async () => {
  const applied = await sourceMigrations(),
    legacy = applied.slice(0, 3),
    legacyContract = '76709ac485937b849bdd5f40c4fddbb4711a2e431e4fd4b9f73a5fbedcc6816d',
    f = fixture();
  expect(applied.map(({ file }) => file)).toEqual([
    '0000_catalog_foundation.sql',
    '0001_explicit_table_options.sql',
    '0002_playback_diagnostics.sql',
    '0003_accounts.sql',
  ]);
  for (const value of Object.values(f.state.components))
    Object.assign(value, { contractHash: legacyContract, migrations: legacy });
  f.state.schema = { migrations: applied };
  f.io.status = async () => ({
    event: 'migration_status',
    empty: false,
    applied,
    pending: [],
  });
  const originalJobs = structuredClone(f.state.components.jobs);
  for (const component of ['api', 'frontend']) {
    await componentFlow(
      {
        component,
        release: release(component, 'b', {
          contractHash: '811b6526cd895d599fff54befa403285dbe3d956176d2eeaeb88e852d00abfee',
          migrations: applied,
          compatibleContracts: policy.compatibleContracts,
          compatibleSchemas: policy.compatibleSchemas,
        }),
      },
      f.io,
    );
    expect(f.state.components.jobs).toEqual(originalJobs);
    expect(f.state.attempt).toBeUndefined();
  }
  expect(f.events.some(([name]) => ['migrate', 'backup'].includes(name))).toBe(false);
  expect(f.events.filter(([name]) => name === 'stop').map(([, roles]) => roles)).toEqual([['api']]);
  expect(
    f.events.filter(([name]) => name === 'publish').map(([, value]) => value.component),
  ).toEqual(['api', 'frontend']);
});
it('backs up before SQL and restores the unselected writer using its original record', async () => {
  const f = fixture({ pending: 1 }),
    original = structuredClone(f.state.components.jobs);
  await componentFlow(
    {
      component: 'api',
      release: release('api', 'b', {
        migrations: migrations('b'),
        compatibleSchemas: [schemaHash(migrations())],
      }),
      otherWritersStopped: true,
    },
    f.io,
  );
  const names = f.events.map(([name]) => name);
  expect(names.indexOf('stop')).toBeLessThan(names.indexOf('backup'));
  expect(names.indexOf('backup')).toBeLessThan(names.indexOf('migrate'));
  expect(f.events.filter(([name]) => name === 'publish').map(([, value]) => value)).toEqual([
    f.state.components.api,
    original,
  ]);
  expect(f.state.components.jobs).toEqual(original);
});
it('persists failed SQL, leaves maintenance and writers stopped, and refuses a new apply', async () => {
  const f = fixture({ empty: true, pending: 1, fail: 'migrate' }),
    options = {
      component: 'api',
      release: release('api'),
      initializeEmpty: true,
      otherWritersStopped: true,
    };
  await expect(componentFlow(options, f.io)).rejects.toThrow('never retry SQL');
  expect(f.state.attempt).toMatchObject({
    phase: 'failed',
    failedStage: 'migration',
    cleanupConfirmed: true,
  });
  expect(f.events.filter(([name]) => name === 'maintenance').at(-1)).toEqual(['maintenance', true]);
  await expect(componentFlow(options, f.io)).rejects.toThrow();
  expect(f.events.filter(([name]) => name === 'migrate')).toHaveLength(1);
});
it.each(['publish', 'verify', 'public'])(
  'restores the original version and fails the build after a no-SQL %s failure',
  async (failedStage) => {
    const f = fixture({
      fail: (name, args) => name === failedStage && args[0]?.revision === 'b'.repeat(40),
    });
    const original = structuredClone(f.state);
    await expect(
      componentFlow({ component: 'api', release: release('api', 'b') }, f.io),
    ).rejects.toThrow('original version restored');
    expect(f.state).toEqual(original);
    expect(f.events.filter(([name]) => name === 'publish').at(-1)[1]).toEqual(
      original.components.api,
    );
    expect(f.events).toContainEqual(['restore', failedStage]);
    expect(f.events.filter(([name]) => name === 'maintenance').at(-1)).toEqual([
      'maintenance',
      false,
    ]);
  },
);
it('does not automatically restore after SQL or when the release lock was lost', async () => {
  for (const pending of [0, 1]) {
    const f = fixture({ fail: 'publish', pending });
    await expect(
      componentFlow(
        {
          component: 'api',
          release: release('api', 'b'),
          otherWritersStopped: true,
          canRestore: () => pending === 1,
        },
        f.io,
      ),
    ).rejects.toThrow('never retry SQL');
    expect(f.events.some(([name]) => name === 'restore')).toBe(false);
    expect(f.state.attempt.phase).toBe('failed');
  }
});
it('keeps a failed restoration in maintenance for explicit recovery', async () => {
  const f = fixture({ fail: 'publish' });
  await expect(
    componentFlow({ component: 'api', release: release('api', 'b') }, f.io),
  ).rejects.toThrow('never retry SQL');
  expect(f.state.attempt).toMatchObject({ phase: 'failed', cleanupConfirmed: true });
  expect(f.events.filter(([name]) => name === 'maintenance').at(-1)).toEqual(['maintenance', true]);
});
it('can restore the original release if completing the persistent record fails', async () => {
  const f = fixture({ fail: 'finish' });
  const original = structuredClone(f.state);
  await expect(
    componentFlow({ component: 'api', release: release('api', 'b') }, f.io),
  ).rejects.toThrow('original version restored');
  expect(f.state).toEqual(original);
});
it('rolls back only the selected component with explicit compatibility confirmation', async () => {
  const f = fixture();
  f.state.previous.api = release('api', 'b');
  await componentFlow({ component: 'api', action: 'rollback', compatibilityConfirmed: true }, f.io);
  expect(f.state.components.api.revision).toBe('b'.repeat(40));
  expect(f.state.components.jobs.revision).toBe('a'.repeat(40));
});
it('rejects mutable tags, extra fields and frontend migration tools', () => {
  for (const value of [
    release('api', 'a', { image: 'registry.example/radio/api:latest' }),
    { ...release('api'), secret: 'unexpected' },
    release('frontend', 'a', { migrationImage: release('api').migrationImage }),
    release('api', 'a', { buildNumber: 42 }),
    release('api', 'a', { buildNumber: '0' }),
  ])
    expect(() => componentRelease(value)).toThrow();
});

it('recovers a failed component without repeating SQL and restores the unselected writer exactly', async () => {
  const f = fixture();
  const original = structuredClone(f.state.components.jobs);
  f.state.attempt = {
    component: 'api',
    candidate: release('api', 'b'),
    affected: ['api', 'jobs'],
    phase: 'failed',
  };
  await componentFlow(
    { component: 'api', action: 'recover', recoveryConfirmed: true, recoveryVersion: 'attempt' },
    f.io,
  );
  expect(f.events.some(([name]) => name === 'migrate')).toBe(false);
  expect(f.events.filter(([name]) => name === 'publish').map(([, value]) => value)).toEqual([
    f.state.components.api,
    original,
  ]);
  expect(f.state.components.jobs).toEqual(original);
  expect(f.state.attempt).toBeUndefined();
});
