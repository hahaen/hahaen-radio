import { expect, it } from 'vitest';
import { access, mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupPriorWorkspaces } from '../scripts/workspace-cleanup.mjs';

it('removes only older workspaces of the same serialized job, preserving other jobs and links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haen-workspace-'));
  const parent = join(root, 'workspace', 'radio');
  await mkdir(parent, { recursive: true });
  const names = [
    'radio-api-plan-42',
    'radio-api-plan-41',
    'radio-api-release-40',
    'radio-api-release-43',
    'radio-jobs-plan-41',
    'other-project',
    'radio-api-plan-invalid',
  ];
  try {
    for (const name of names) await mkdir(join(parent, name));
    await symlink(join(parent, 'other-project'), join(parent, 'radio-api-release-39'));
    expect(await cleanupPriorWorkspaces(join(parent, names[0]), '42')).toBe(2);
    for (const name of [names[1], names[2]])
      await expect(access(join(parent, name))).rejects.toThrow();
    for (const name of [names[0], ...names.slice(3), 'radio-api-release-39'])
      await access(join(parent, name));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('refuses to clean an arbitrary path or a mismatched build number', async () => {
  await expect(cleanupPriorWorkspaces('/tmp/other-project', '42')).rejects.toThrow();
  await expect(cleanupPriorWorkspaces('/tmp/radio-api-plan-42', '43')).rejects.toThrow();
});
