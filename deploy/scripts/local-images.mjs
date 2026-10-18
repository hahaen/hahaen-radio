import assert from 'node:assert/strict';
import { lstat, readFile, readlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { idPattern, localEngine } from './release/common.mjs';
import { imageIdentity } from './release/images.mjs';

export async function engineIdentity(run) {
  await localEngine(run);
  const id = await run(['info', '--format', '{{.ID}}']);
  assert(/^[A-Za-z0-9:-]{12,128}$/.test(id));
  return id;
}
export async function localImage(run, item, revision, platform) {
  assert(idPattern.test(item.id));
  const image = await imageIdentity(run, item.id, revision, platform);
  assert.equal(image.Id, item.id);
  assert.equal((await imageIdentity(run, item.tag, revision, platform)).Id, item.id);
  return item.id;
}
export function retainedReleases(state) {
  return [
    ...Object.values(state.components),
    ...Object.values(state.previous),
    state.attempt?.candidate,
  ].filter(Boolean);
}
export function currentOnlyState(state, component) {
  assert(['frontend', 'api', 'jobs'].includes(component));
  const previous = { ...state.previous },
    retired = previous[component];
  delete previous[component];
  const previousVersions = { ...state.previousVersions };
  if (retired)
    previousVersions[component] = {
      revision: retired.revision,
      ...(retired.buildNumber === undefined ? {} : { buildNumber: retired.buildNumber }),
    };
  return { state: { ...state, previous, previousVersions }, retired: retired ? [retired] : [] };
}
export async function pruneLocalImages(run, state, config, retired) {
  // Only a displaced successful release is eligible. Other jobs may still be building images.
  const kept = retainedReleases(state),
    protectedIds = new Set();
  for (const reference of [
    state.schema?.image,
    ...kept.flatMap((v) => [v.image, v.migrationImage]),
  ].filter(Boolean)) {
    const rows = JSON.parse(await run(['image', 'inspect', reference]));
    assert.equal(rows.length, 1);
    assert(idPattern.test(rows[0].Id));
    protectedIds.add(rows[0].Id);
  }
  const unique = new Map(retired.map((value) => [value.component + value.validationRun, value]));
  for (const value of unique.values()) {
    for (const reference of new Set([value.image, value.migrationImage].filter(Boolean))) {
      const image = await imageIdentity(run, reference, value.revision, value.platform);
      if (protectedIds.has(image.Id)) continue;
      const tags = image.RepoTags ?? [];
      assert(image.Config.Labels['io.haen.project'] === 'radio' || tags.length > 0);
      assert(
        tags.every(
          (tag) =>
            /^radio-local\/(frontend|api|jobs|migration):[a-f0-9]{40}-(?:[1-9][0-9]{0,18}-)?[a-f0-9]{12}$/.test(
              tag,
            ) ||
            new RegExp(
              '^(?:radio-local|localhost:5043/radio)/(frontend|api|jobs|migration)@' +
                image.Id +
                '$',
            ).test(tag),
        ),
      );
      let directory;
      if (value.component === 'frontend' && reference === value.image) {
        directory = join(config.staticDirectory, 'releases', image.Id.slice(7));
        assert.notEqual(
          await readlink(join(config.staticDirectory, 'current')),
          'releases/' + image.Id.slice(7) + '/site',
        );
        const stat = await lstat(directory);
        assert(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid());
        const receipt = JSON.parse(await readFile(join(directory, 'receipt.json'), 'utf8'));
        assert.equal(receipt.imageId, image.Id);
        assert.equal(receipt.revision, value.revision);
      }
      if (tags.length) await run(['image', 'rm', ...tags]);
      else await run(['image', 'rm', image.Id]);
      if (directory) await rm(directory, { recursive: true });
    }
    if (
      value.component !== 'frontend' &&
      !kept.some((v) => v.component === value.component && v.validationRun === value.validationRun)
    ) {
      const file = join(
        config.stateDirectory,
        'environments',
        value.component + '-' + value.validationRun + '.env',
      );
      assert(
        ['api', 'jobs'].includes(value.component) && /^[a-f0-9]{12}$/.test(value.validationRun),
      );
      const stat = await lstat(file);
      assert(
        stat.isFile() &&
          !stat.isSymbolicLink() &&
          stat.uid === process.getuid() &&
          (stat.mode & 0o777) === 0o600,
      );
      await rm(file);
    }
  }
}
