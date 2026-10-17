import { afterEach, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const entry = fileURLToPath(new URL('../scripts/release/source-selection.mjs', import.meta.url));
const roots = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'haen-source-'));
  roots.push(root);
  const origin = join(root, 'origin');
  const checkout = join(root, 'checkout');
  await mkdir(origin);
  await exec('git', ['init', '--quiet', '--initial-branch=release/candidate'], { cwd: origin });
  const commit = (cwd) =>
    exec(
      'git',
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--quiet',
        '--allow-empty',
        '-m',
        'fixture',
      ],
      { cwd },
    );
  await commit(origin);
  await exec('git', ['clone', '--quiet', '--no-hardlinks', origin, checkout]);
  const revision = (await exec('git', ['rev-parse', 'HEAD'], { cwd: checkout })).stdout.trim();
  return {
    origin,
    checkout,
    revision,
    commit,
    receipt: join(checkout, '.local/archive/release-pipeline/source.json'),
    select: (branch = 'release/candidate') =>
      exec(process.execPath, [entry], {
        cwd: checkout,
        env: { ...process.env, HAEN_SOURCE_BRANCH: branch },
      }),
  };
}
it('records the fetched commit for a slash branch even when its remote advances afterward', async () => {
  const f = await fixture();
  await f.commit(f.origin);
  expect((await f.select()).stdout.trim()).toBe(f.revision);
  expect(JSON.parse(await readFile(f.receipt, 'utf8'))).toEqual({
    format: 1,
    branch: 'release/candidate',
    revision: f.revision,
  });
});
it('refuses a checkout that no longer matches the selected remote ref without a receipt', async () => {
  const f = await fixture();
  await f.commit(f.checkout);
  await expect(f.select()).rejects.toMatchObject({ code: 1 });
  await expect(readFile(f.receipt)).rejects.toMatchObject({ code: 'ENOENT' });
});
it('refuses invalid branch syntax before creating a source receipt', async () => {
  const f = await fixture();
  for (const branch of ['../main', 'release/../main', 'main\nother', 'main$(echo)'])
    await expect(f.select(branch)).rejects.toMatchObject({ code: 1 });
  await expect(readFile(f.receipt)).rejects.toMatchObject({ code: 'ENOENT' });
});
