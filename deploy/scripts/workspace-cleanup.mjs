import assert from 'node:assert/strict';
import { lstat, readdir, rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function cleanupPriorWorkspaces(current, buildNumber) {
  assert(/^[1-9][0-9]{0,18}$/.test(buildNumber));
  const own = /^(radio-(?:frontend|api|jobs))-(?:plan|release)-([1-9][0-9]{0,18})$/.exec(
    basename(current),
  );
  assert(own && own[2] === buildNumber);
  const parent = dirname(current),
    pattern = new RegExp('^' + own[1] + '-(?:plan|release)-([1-9][0-9]{0,18})$');
  assert(basename(parent) === 'radio' && basename(dirname(parent)) === 'workspace');
  const active = await lstat(current);
  assert(active.isDirectory() && !active.isSymbolicLink() && active.uid === process.getuid());
  let removed = 0;
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    const match = pattern.exec(entry.name);
    if (!entry.isDirectory() || !match || BigInt(match[1]) >= BigInt(buildNumber)) continue;
    const path = resolve(parent, entry.name),
      stat = await lstat(path);
    if (stat.isSymbolicLink() || stat.uid !== process.getuid()) continue;
    await rm(path, { recursive: true });
    removed++;
  }
  return removed;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    assert(process.env.CI === 'true');
    const removed = await cleanupPriorWorkspaces(process.cwd(), process.env.BUILD_NUMBER);
    console.info(JSON.stringify({ event: 'workspace_cleanup_completed', removed }));
  } catch {
    // Cleanup is limited to this serialized job and must not hide its release result.
    console.error(JSON.stringify({ event: 'workspace_cleanup_incomplete' }));
  }
}
