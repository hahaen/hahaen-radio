import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { docker, outputDirectory, load, save } from './common.mjs';
import {
  buildImages,
  publishImages,
  registryConfiguration,
  validateImageCheck,
} from './images.mjs';
import { smokeImages } from './smoke.mjs';

export async function execute(stage, env, signal) {
  assert.equal(process.version, 'v24.9.0');
  assert.equal(env.CI, 'true');
  const directory = await outputDirectory();
  if (stage === 'build') {
    const build = await buildImages(
      docker(signal),
      env.HAEN_SOURCE_COMMIT,
      env.HAEN_IMAGE_REPOSITORY,
      env.HAEN_RELEASE_PLATFORM,
      signal,
    );
    await save(join(directory, 'build.json'), build);
  } else if (stage === 'test-images') {
    const build = await load(join(directory, 'build.json'));
    const check = await smokeImages(
      docker(signal),
      build,
      env.HAEN_TEST_MYSQL_IMAGE,
      directory,
      signal,
    );
    validateImageCheck(check, build);
    await save(join(directory, 'image-check.json'), check);
  } else if (stage === 'publish') {
    const build = await load(join(directory, 'build.json'));
    const check = await load(join(directory, 'image-check.json'));
    validateImageCheck(check, build);
    const config = await registryConfiguration(
      env.HAEN_REGISTRY_CONFIG_FILE,
      directory,
      build.repository,
    );
    try {
      const release = await publishImages(
        docker(signal, { ...process.env, DOCKER_CONFIG: config }),
        build,
        check,
      );
      await save(join(directory, 'release.json'), release);
    } finally {
      await rm(config, { recursive: true, force: true });
    }
  } else throw Error('Unknown release stage');
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    await execute(process.argv[2], process.env, controller.signal);
    controller.signal.throwIfAborted();
    console.info(JSON.stringify({ event: 'release_stage_completed', stage: process.argv[2] }));
  } catch {
    console.error(
      JSON.stringify({
        event: 'release_stage_failed',
        instruction:
          'Inspect this stage configuration and owned isolated resources; do not deploy without verified immutable release metadata',
      }),
    );
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}
