import { afterEach, expect, it } from 'vitest';
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { activateStaticWeb, assertStaticWeb, prepareStaticWeb } from '../scripts/static-web.mjs';
const roots = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'radio-static-'));
  roots.push(root);
  const config = { staticDirectory: join(root, 'web') };
  await mkdir(config.staticDirectory);
  const source = join(root, 'artifact');
  await mkdir(source);
  await mkdir(join(source, 'assets'));
  await writeFile(join(source, 'index.html'), '<script src="/radio/assets/app.js"></script>', {
    mode: 0o600,
  });
  await writeFile(join(source, 'assets/app.js'), 'console.log("public")', { mode: 0o600 });
  const calls = [];
  const release = (letter) => ({
    images: { web: 'registry.example/radio/web@sha256:' + letter.repeat(64) },
    imageRevisions: { web: letter.repeat(40) },
    platform: 'linux/amd64',
  });
  const run = async (args) => {
    calls.push(args);
    if (args[0] === 'image') {
      const letter = args[2].split('sha256:')[1][0];
      return JSON.stringify([
        {
          Id: 'sha256:' + letter.repeat(64),
          Os: 'linux',
          Architecture: 'amd64',
          Config: { Labels: { 'org.opencontainers.image.revision': letter.repeat(40) } },
        },
      ]);
    }
    if (args[0] === 'create') return 'c'.repeat(64);
    if (args[0] === 'cp') {
      await cp(source, args[2], { recursive: true });
      return '';
    }
    if (args[0] === 'rm') return '';
    throw Error('Unexpected artifact command');
  };
  return { root, source, config, release, run, calls };
}
it('publishes gateway-readable files, switches whole versions and reuses a verified version for rollback', async () => {
  const f = await fixture();
  await activateStaticWeb(f.run, f.release('a'), f.config);
  const first = await readlink(join(f.config.staticDirectory, 'current'));
  await writeFile(join(f.source, 'index.html'), 'second version');
  await activateStaticWeb(f.run, f.release('b'), f.config);
  expect(await readFile(join(f.config.staticDirectory, 'current/index.html'), 'utf8')).toBe(
    'second version',
  );
  await activateStaticWeb(f.run, f.release('a'), f.config);
  expect(await readlink(join(f.config.staticDirectory, 'current'))).toBe(first);
  expect((await assertStaticWeb(f.release('a'), f.config)).revision).toBe('a'.repeat(40));
  expect(f.calls.filter((args) => args[0] === 'create')).toHaveLength(2);
  expect(f.calls.some((args) => args[0] === 'start' || args[0] === 'run')).toBe(false);
  const { stat } = await import('node:fs/promises');
  expect((await stat(join(f.config.staticDirectory, 'current/index.html'))).mode & 0o777).toBe(
    0o644,
  );
});
it('refuses tampered retained files before switching away from the current version', async () => {
  const f = await fixture();
  await activateStaticWeb(f.run, f.release('a'), f.config);
  await prepareStaticWeb(f.run, f.release('b'), f.config);
  await writeFile(
    join(f.config.staticDirectory, 'releases', 'b'.repeat(64), 'site/index.html'),
    'tampered',
  );
  await expect(activateStaticWeb(f.run, f.release('b'), f.config)).rejects.toThrow();
  await assertStaticWeb(f.release('a'), f.config);
});
it('cleans only its extraction container on copy failure and preserves the active files', async () => {
  const f = await fixture();
  await activateStaticWeb(f.run, f.release('a'), f.config);
  const cleanup = [];
  await expect(
    activateStaticWeb(
      async (args) => {
        if (args[0] === 'cp') throw Error('canceled copy');
        return f.run(args);
      },
      f.release('b'),
      f.config,
      async (args) => cleanup.push(args),
    ),
  ).rejects.toThrow('canceled copy');
  expect(cleanup).toEqual([['rm', '--volumes', 'c'.repeat(64)]]);
  expect(
    (await readdir(join(f.config.staticDirectory, 'releases'))).some((name) =>
      name.startsWith('.incoming-'),
    ),
  ).toBe(false);
  await assertStaticWeb(f.release('a'), f.config);
});
it('rejects symlinks inside a static artifact rather than exposing files outside the public tree', async () => {
  const f = await fixture();
  await chmod(f.source, 0o755);
  await symlink('/etc/passwd', join(f.source, 'private'));
  await expect(prepareStaticWeb(f.run, f.release('a'), f.config)).rejects.toThrow();
  expect(await readdir(join(f.config.staticDirectory, 'releases'))).toEqual([]);
});
