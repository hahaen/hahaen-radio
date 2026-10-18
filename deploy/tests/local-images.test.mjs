import { expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localImage, pruneLocalImages } from '../scripts/local-images.mjs';
const id = (c) => 'sha256:' + c.repeat(64);
const release = (component, c) => ({
  component,
  image: id(c),
  migrationImage: null,
  revision: c.repeat(40),
  platform: 'linux/amd64',
  validationRun: c.repeat(12),
});
const image = (c, tags = []) => ({
  Id: id(c),
  RepoTags: tags,
  Config: {
    Labels: { 'org.opencontainers.image.revision': c.repeat(40), 'io.haen.project': 'radio' },
  },
  Os: 'linux',
  Architecture: 'amd64',
});
it('rejects a tag changed after component validation', async () => {
  const run = async (args) => JSON.stringify([image(args[2] === id('a') ? 'a' : 'b')]);
  await expect(
    localImage(run, { id: id('a'), tag: 'radio-local/api:changed' }, 'a'.repeat(40), 'linux/amd64'),
  ).rejects.toThrow();
});
it('protects current, previous and schema images and never sweeps a concurrent build', async () => {
  const commands = [],
    values = { a: image('a'), b: image('b'), c: image('c') };
  const run = async (args) => {
    commands.push(args);
    return JSON.stringify([values[args[2]?.at(-1)]]);
  };
  await pruneLocalImages(
    run,
    {
      components: { frontend: release('frontend', 'a') },
      previous: { frontend: release('frontend', 'b') },
      schema: { image: id('c') },
    },
    {},
    [release('frontend', 'b')],
  );
  expect(commands.every((args) => args[0] === 'image' && args[1] === 'inspect')).toBe(true);
  expect(commands.some((args) => args.includes('ls'))).toBe(false);
});
it('removes only an explicitly retired successful project image with owned tags', async () => {
  const commands = [],
    tag = 'radio-local/api:' + 'd'.repeat(40) + '-' + 'd'.repeat(12),
    legacyAlias = 'localhost:5043/radio/api@' + id('d');
  const run = async (args) => {
    commands.push(args);
    return args[1] === 'inspect'
      ? JSON.stringify([image(args[2].at(-1), args[2] === id('d') ? [tag, legacyAlias] : [])])
      : '';
  };
  const root = await mkdtemp(join(tmpdir(), 'radio-retired-'));
  await mkdir(join(root, 'environments'));
  const snapshot = join(root, 'environments', 'api-' + 'd'.repeat(12) + '.env');
  await writeFile(snapshot, 'NODE_ENV=production\n', { mode: 0o600 });
  try {
    await pruneLocalImages(
      run,
      {
        components: { api: release('api', 'a') },
        previous: { api: release('api', 'b') },
        schema: { image: id('c') },
      },
      { stateDirectory: root },
      [release('api', 'd')],
    );
    expect(commands.filter((args) => args[1] === 'rm')).toEqual([
      ['image', 'rm', tag, legacyAlias],
    ]);
    await expect(access(snapshot)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it.each(['other-project/service:stable', 'localhost:5043/radio/api@' + id('e')])(
  'refuses unowned or mismatched digest aliases: %s',
  async (tag) => {
    const commands = [];
    const run = async (args) => {
      commands.push(args);
      return JSON.stringify([image('d', [tag])]);
    };
    await expect(
      pruneLocalImages(run, { components: {}, previous: {} }, {}, [release('api', 'd')]),
    ).rejects.toThrow();
    expect(commands.some((args) => args[1] === 'rm')).toBe(false);
  },
);
