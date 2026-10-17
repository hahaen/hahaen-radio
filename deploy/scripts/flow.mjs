import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { imageReference, platform, revisionPattern, roles } from './release/common.mjs';

export function validateRelease(value) {
  assert(value?.format === 1 && revisionPattern.test(value.revision));
  platform(value.platform);
  assert(/^[a-f0-9]{12}$/.test(value.imageCheckRun));
  const repositories = new Set();
  for (const role of roles) {
    const image = imageReference(value.images?.[role]);
    const repository = image.split('@')[0];
    assert(repository.endsWith('/' + role));
    repositories.add(repository.slice(0, -role.length - 1));
  }
  assert.equal(repositories.size, 1);
  assert(
    Array.isArray(value.migrations) &&
      value.migrations.length > 0 &&
      value.migrations.length < 1000,
  );
  for (const item of value.migrations)
    assert(/^\d{4}_[a-z0-9_]+\.sql$/.test(item.file) && /^[a-f0-9]{64}$/.test(item.sha256));
  assert.equal(new Set(value.migrations.map((item) => item.file)).size, value.migrations.length);
  return value;
}
export function sameMigrations(a, b) {
  return JSON.stringify(a.migrations) === JSON.stringify(b.migrations);
}
export function checkStatus(status, release, complete = false) {
  assert(status?.event === 'migration_status');
  assert.deepEqual(
    status.expected.map((item) => ({ file: item.file, sha256: item.hash })),
    release.migrations,
  );
  assert(Array.isArray(status.applied) && Array.isArray(status.pending));
  assert.equal(status.applied.length + status.pending.length, release.migrations.length);
  if (complete) assert(!status.empty && status.pending.length === 0);
  return status;
}
export function validateInstalled(value) {
  validateRelease(value);
  for (const role of roles) assert(revisionPattern.test(value.imageRevisions?.[role]));
  return value;
}
export async function deployFlow(options, io) {
  const { action, scope } = options;
  assert(['apply', 'rollback', 'recover'].includes(action));
  assert(['full', 'web', 'server'].includes(scope));
  const state = await io.state();
  assert(state?.format === 1);
  if (state.current) validateInstalled(state.current);
  if (state.previous) validateInstalled(state.previous);
  if (state.attempt)
    assert(
      action === 'recover' &&
        [
          'prepared',
          'maintenance',
          'stopped',
          'backup',
          'backup-verified',
          'migration',
          'catalog',
          'api',
          'web',
          'jobs',
          'activation',
          'failed',
        ].includes(state.attempt.phase) &&
        options.recoveryConfirmed === true,
    );
  else assert(action !== 'recover');
  let candidate;
  if (action === 'apply') {
    const release = validateRelease(options.release);
    candidate = {
      ...release,
      images: { ...release.images },
      imageRevisions: Object.fromEntries(roles.map((role) => [role, release.revision])),
    };
    if (scope !== 'full') {
      assert(state.current && options.compatibilityConfirmed === true);
      if (scope === 'web') {
        assert(sameMigrations(release, state.current));
        for (const role of ['server', 'migration']) {
          candidate.images[role] = state.current.images[role];
          candidate.imageRevisions[role] = state.current.imageRevisions[role];
        }
      } else {
        candidate.images.web = state.current.images.web;
        candidate.imageRevisions.web = state.current.imageRevisions.web;
      }
    }
  } else {
    assert(
      scope === 'full' &&
        (state.current || (action === 'recover' && options.recoveryVersion === 'attempt')),
    );
    candidate = validateInstalled(
      action === 'recover'
        ? options.recoveryVersion === 'attempt'
          ? state.attempt.candidate
          : state.current
        : state.previous,
    );
    if (action === 'rollback') {
      assert(options.compatibilityConfirmed === true);
      assert(sameMigrations(candidate, state.current));
    }
  }
  validateInstalled(candidate);
  await io.prepare(candidate, state.current, action === 'apply', Boolean(state.attempt));
  const before = checkStatus(await io.status(candidate), candidate);
  if (action !== 'apply' || scope === 'web') checkStatus(before, candidate, true);
  if (before.empty) assert(options.initializeEmpty === true);
  if (before.pending.length) assert(options.otherWritersStopped === true);
  if (!before.empty && before.pending.length && !state.current)
    assert(revisionPattern.test(options.baselineRevision));
  const attempt = {
    id: randomBytes(12).toString('hex'),
    action,
    scope,
    revision: candidate.revision,
    candidate,
    phase: 'prepared',
    startedAt: new Date().toISOString(),
  };
  await io.begin(state, attempt);
  let stage = 'prepared';
  const advance = async (phase) => {
    stage = phase;
    await io.phase(phase);
  };
  try {
    await advance('maintenance');
    await io.maintenance(true);
    await io.web(state.current ?? candidate);
    await io.checkMaintenance(true);
    if (scope !== 'web') {
      await advance('stopped');
      await io.stop();
      const stopped = checkStatus(await io.status(candidate), candidate);
      assert.deepEqual(stopped, before);
      if (stopped.pending.length) {
        assert(options.otherWritersStopped === true);
        if (!stopped.empty) {
          await advance('backup');
          const id = await io.backup(
            state.current?.imageRevisions.server ?? options.baselineRevision,
          );
          assert(typeof id === 'string' && /^haen-\d{8}T\d{9}Z-[a-f0-9]{12}$/.test(id));
          await io.phase('backup-verified', { backupId: id });
        }
        await advance('migration');
        await io.migrate(candidate, Boolean(stopped.empty));
        checkStatus(await io.status(candidate), candidate, true);
      }
      await advance('catalog');
      await io.catalog(candidate);
      await advance('api');
      await io.api(candidate);
    }
    await advance('web');
    await io.web(candidate);
    await io.checkWeb(candidate);
    if (scope !== 'web') {
      await advance('jobs');
      await io.jobs(candidate);
    }
    await io.checkRuntime(candidate);
    await advance('activation');
    await io.activate(
      candidate,
      action === 'recover' && options.recoveryVersion !== 'attempt'
        ? state.previous
        : state.current,
    );
    await io.maintenance(false);
    await io.checkMaintenance(false);
    await io.checkPublic(candidate);
    await io.finish();
    return { revision: candidate.revision, action, scope };
  } catch {
    let cleanupConfirmed = false;
    try {
      await io.maintenance(true);
      await io.stop();
      await io.checkMaintenance(true);
      cleanupConfirmed = true;
    } catch {
      /* Persist incomplete cleanup for an operator; never auto-retry SQL. */
    }
    await io.fail(stage, cleanupConfirmed);
    throw Error('Target release failed; inspect persisted attempt and maintenance before recovery');
  }
}
