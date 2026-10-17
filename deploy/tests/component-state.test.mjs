import { expect, it } from 'vitest';
import { componentFlow, componentRelease, schemaHash } from '../scripts/component-state.mjs';
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
        if (name === fail) throw Error('injected failure');
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
