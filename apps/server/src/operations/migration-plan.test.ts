import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expectedMigrations, pendingMigrations } from './migration-plan.js';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const expected = [
  { hash: 'a'.repeat(64), createdAt: '1000' },
  { hash: 'b'.repeat(64), createdAt: '2000' },
];
it('accepts only an exact ordered prefix, including timestamps, and reports the remaining migration', () => {
  expect(pendingMigrations(expected, [])).toEqual(expected);
  expect(pendingMigrations(expected, [expected[0]])).toEqual([expected[1]]);
  expect(pendingMigrations(expected, expected)).toEqual([]);
  for (const rows of [
    [expected[1]],
    [{ ...expected[0], createdAt: '999' }],
    [...expected, expected[1]],
    [{ ...expected[0], hash: 'c'.repeat(64) }],
  ])
    expect(() => pendingMigrations(expected, rows)).toThrow();
});
it('rejects malformed or unbounded migration history before it becomes a plan', () => {
  expect(() => pendingMigrations(expected, [{ hash: 'not-a-hash', createdAt: '1000' }])).toThrow();
  expect(() => pendingMigrations(expected, [{ hash: 'a'.repeat(64), createdAt: '0' }])).toThrow();
  expect(() => pendingMigrations(expected, Array(1001).fill(expected[0]))).toThrow();
});
async function fixture(entries: unknown[]) {
  const root = await mkdtemp(join(tmpdir(), 'haen-migration-plan-'));
  roots.push(root);
  await mkdir(join(root, 'meta'));
  await writeFile(join(root, 'meta/_journal.json'), JSON.stringify({ entries }));
  return root;
}
it('rejects duplicate names and non-increasing journal order', async () => {
  const a = { idx: 0, when: 1000, tag: '0000_first' },
    b = { idx: 1, when: 999, tag: '0001_next' };
  await expect(expectedMigrations(await fixture([a, b]))).rejects.toThrow();
  await expect(
    expectedMigrations(await fixture([a, { ...a, idx: 1, when: 2000 }])),
  ).rejects.toThrow();
});
it('detects a changed released SQL file against its recorded history', async () => {
  const root = await fixture([{ idx: 0, when: 1000, tag: '0000_first', breakpoints: true }]);
  await writeFile(
    join(root, 'meta/0000_snapshot.json'),
    JSON.stringify({ version: '5', dialect: 'mysql', tables: { fixture: { name: 'fixture' } } }),
  );
  await writeFile(join(root, '0000_first.sql'), 'CREATE TABLE fixture(id int);');
  const released = await expectedMigrations(root);
  await writeFile(join(root, '0000_first.sql'), 'CREATE TABLE changed(id int);');
  const changed = await expectedMigrations(root);
  expect(() => pendingMigrations(changed, released)).toThrow();
});

it('loads the application migration history without a database connection', async () => {
  const plan = await expectedMigrations();
  expect(plan.map((entry) => entry.file)).toEqual([
    '0000_catalog_foundation.sql',
    '0001_explicit_table_options.sql',
    '0002_playback_diagnostics.sql',
    '0003_accounts.sql',
  ]);
  expect(plan.at(-1)!.tables).toContain('playback_reports');
});
