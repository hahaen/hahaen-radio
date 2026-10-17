import { it, expect } from 'vitest';
import { mkdtemp, chmod, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { assertRuntimeLogImage, runtimeLogProbe } from '../../scripts/deploy/runtime-logs.mjs';
const exec = promisify(execFile);
it('runs the actual probe and rejects old-boot, wrong-version and unsafe-mode records', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'haen-log-probe-'));
  await chmod(directory, 0o700);
  const now = Date.now(),
    path = join(directory, `haen-${now}-aaaaaaaaaaaa.jsonl`);
  const row = {
    time: new Date(now).toISOString(),
    service: 'jobs',
    revision: 'a'.repeat(40),
    event: 'scheduler_started',
  };
  const probe = (since = now, revision = 'a'.repeat(40)) =>
    exec(process.execPath, [
      '--input-type=module',
      '-e',
      runtimeLogProbe('jobs', revision, 'scheduler_started', since, directory),
    ]);
  try {
    await writeFile(path, JSON.stringify(row) + '\n', { mode: 0o600 });
    expect((await probe()).stdout.trim()).toBe('ready');
    await expect(probe(now + 1)).rejects.toThrow();
    await expect(probe(now, 'b'.repeat(40))).rejects.toThrow();
    await chmod(path, 0o644);
    await expect(probe()).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it('refuses legacy server images before a maintenance attempt can begin', () => {
  expect(() =>
    assertRuntimeLogImage({ Config: { Labels: { 'io.haen.runtime-log': 'private-jsonl-v1' } } }),
  ).not.toThrow();
  expect(() => assertRuntimeLogImage({ Config: { Labels: {} } })).toThrow();
});
