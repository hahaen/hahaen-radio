import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { imageReference, idPattern, platform, revisionPattern } from './release/common.mjs';
export const components = ['frontend', 'api', 'jobs'];
export const schemaHash = (migrations) =>
  createHash('sha256')
    .update(JSON.stringify(migrations.map(({ file, sha256 }) => [file, sha256])))
    .digest('hex');
const digest = /^[a-f0-9]{64}$/;
function componentImage(value) {
  if (!idPattern.test(value)) imageReference(value);
}
export function componentRelease(value) {
  assert(value?.format === 2 && components.includes(value.component));
  assert.deepEqual(
    Object.keys(value).sort(),
    [
      'format',
      'component',
      'revision',
      'platform',
      'image',
      'migrationImage',
      'migrations',
      'contractHash',
      'compatibleContracts',
      'compatibleSchemas',
      'validationRun',
      ...(value.buildNumber === undefined ? [] : ['buildNumber']),
    ].sort(),
  );
  assert(revisionPattern.test(value.revision));
  if (value.buildNumber !== undefined)
    assert(typeof value.buildNumber === 'string' && /^[1-9][0-9]{0,18}$/.test(value.buildNumber));
  platform(value.platform);
  componentImage(value.image);
  assert(digest.test(value.contractHash));
  assert(/^[a-f0-9]{12}$/.test(value.validationRun));
  assert(
    Array.isArray(value.migrations) &&
      value.migrations.length > 0 &&
      value.migrations.length < 1000,
  );
  for (const row of value.migrations)
    assert(
      Object.keys(row).sort().join(',') === 'file,sha256' &&
        /^\d{4}_[a-z0-9_]+\.sql$/.test(row.file) &&
        digest.test(row.sha256),
    );
  assert(new Set(value.migrations.map((row) => row.file)).size === value.migrations.length);
  for (const name of ['compatibleContracts', 'compatibleSchemas'])
    assert(
      Array.isArray(value[name]) &&
        value[name].length <= 100 &&
        value[name].every((hash) => digest.test(hash)),
    );
  if (value.migrationImage !== null) {
    assert(value.component !== 'frontend');
    componentImage(value.migrationImage);
  }
  return value;
}
export function webRelease(value) {
  return {
    platform: value.platform,
    images: { web: value.image },
    imageRevisions: { web: value.revision },
  };
}
export function compatibleCombination(state, candidate, nextSchema) {
  for (const [name, installed] of Object.entries(state.components)) {
    componentRelease(installed);
    assert.equal(installed.component, name);
    if (name === candidate.component) continue;
    assert(
      installed.contractHash === candidate.contractHash ||
        candidate.compatibleContracts.includes(installed.contractHash),
      'Incompatible component contract; review an explicit compatibility declaration',
    );
    if (name !== 'frontend' && nextSchema)
      assert(
        schemaHash(installed.migrations) === schemaHash(nextSchema) ||
          candidate.compatibleSchemas.includes(schemaHash(installed.migrations)),
        'Unselected writer is not declared compatible with the schema',
      );
  }
  if (candidate.component !== 'frontend' && nextSchema)
    assert(
      schemaHash(candidate.migrations) === schemaHash(nextSchema) ||
        candidate.compatibleSchemas.includes(schemaHash(nextSchema)),
      'Selected writer does not support the actual schema',
    );
  if (candidate.component === 'frontend')
    assert(state.components.api, 'Publish the API before the frontend');
}
export async function componentFlow(options, io) {
  const { component, action = 'apply' } = options;
  assert(components.includes(component) && ['apply', 'rollback', 'recover'].includes(action));
  const state = await io.state();
  assert(state.format === 2 && state.components && state.previous);
  const recovering = Boolean(state.attempt);
  assert(
    recovering
      ? action === 'recover' &&
          options.recoveryConfirmed === true &&
          state.attempt.component === component
      : action !== 'recover',
  );
  const candidate = componentRelease(
    action === 'apply'
      ? options.release
      : action === 'rollback'
        ? state.previous[component]
        : options.recoveryVersion === 'attempt'
          ? state.attempt.candidate
          : options.recoveryVersion === 'previous'
            ? state.previous[component]
            : state.components[component],
  );
  const original = structuredClone(state);
  assert.equal(candidate.component, component);
  if (action === 'rollback') assert(options.compatibilityConfirmed === true);
  await io.prepare(candidate, action === 'apply', recovering);
  const status = await io.status(candidate);
  assert(status.event === 'migration_status');
  assert(Array.isArray(status.pending) && Array.isArray(status.applied));
  const pending = status.pending.length;
  if (action !== 'apply' || component === 'frontend') assert.equal(pending, 0);
  if (!state.schema) assert(status.empty && component !== 'frontend');
  if (status.empty) assert(options.initializeEmpty === true);
  if (pending) assert(candidate.migrationImage && options.otherWritersStopped === true);
  const nextSchema = pending
    ? candidate.migrations
    : (state.schema?.migrations ?? candidate.migrations);
  compatibleCombination(state, candidate, nextSchema);
  const affected = recovering
    ? state.attempt.affected
    : pending
      ? ['api', 'jobs']
      : component === 'frontend'
        ? []
        : [component];
  assert(
    Array.isArray(affected) &&
      affected.every((name) => ['api', 'jobs'].includes(name)) &&
      new Set(affected).size === affected.length,
  );
  const attempt = {
    id: randomBytes(12).toString('hex'),
    component,
    action,
    candidate,
    affected,
    phase: 'prepared',
    startedAt: new Date().toISOString(),
  };
  await io.begin(attempt);
  let stage = 'prepared';
  const phase = async (name) => {
    stage = name;
    await io.phase(name);
  };
  try {
    await phase('maintenance');
    await io.maintenance(true);
    await io.checkMaintenance(true);
    if (affected.length) {
      await phase('stopped');
      await io.stop(affected);
    }
    if (pending) {
      const stopped = await io.status(candidate);
      assert.deepEqual(stopped, status);
      if (!status.empty) {
        await phase('backup');
        await io.backup(state.components.api?.revision ?? state.components.jobs?.revision);
      }
      await phase('migration');
      await io.migrate(candidate, status.empty);
      const completed = await io.status(candidate);
      assert.equal(completed.pending.length, 0);
      assert(!completed.empty);
      await io.recordSchema(candidate);
    }
    if (component !== 'frontend') {
      await phase('catalog');
      await io.catalog(candidate);
    }
    await phase('publish');
    await io.publish(candidate);
    if (pending || recovering) {
      await phase('restore-unselected');
      for (const name of ['api', 'jobs'])
        if (name !== component && state.components[name]) await io.publish(state.components[name]);
    }
    await phase('verify');
    await io.verify(candidate);
    for (const [name, value] of Object.entries(state.components))
      if (name !== component) await io.verify(value);
    await phase('activation');
    await io.activate(candidate);
    await io.maintenance(false);
    await io.checkMaintenance(false);
    await phase('public');
    await io.public(candidate);
    await io.finish();
    return { component, revision: candidate.revision, action };
  } catch {
    // A migration may have changed the schema even when its final check failed.
    // Only an ordinary apply with no SQL is eligible for automatic restoration.
    if (
      action === 'apply' &&
      !pending &&
      !recovering &&
      original.components[component] &&
      (options.canRestore?.() ?? true)
    ) {
      let restored = false;
      try {
        await io.maintenance(true);
        if (affected.length) await io.stop(affected);
        const previous = original.components[component];
        await io.publish(previous);
        await io.verify(previous);
        await io.maintenance(false);
        await io.checkMaintenance(false);
        await io.public(previous);
        await io.restore(original, stage);
        restored = true;
      } catch {
        // Leave the durable attempt and maintenance state for explicit recovery.
      }
      if (restored) throw Error('Component release failed; original version restored');
    }
    let cleanupConfirmed = false;
    try {
      await io.maintenance(true);
      if (affected.length) await io.stop(affected);
      await io.checkMaintenance(true);
      cleanupConfirmed = true;
    } catch {
      /* Preserve incomplete cleanup for explicit recovery. */
    }
    await io.fail(stage, cleanupConfirmed);
    throw Error(
      'Component release failed; inspect persistent attempt before recovery; never retry SQL automatically',
    );
  }
}
