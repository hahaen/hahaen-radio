import { expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { maintenanceKey, runMaintenanceClient } from './maintenance.js';
import { migrateDatabase } from './migrate.js';

it('isolates maintenance keys per database and fits the MySQL 64-character bound', () => {
  expect(maintenanceKey('ha_radio_dev')).toBe(maintenanceKey('ha_radio_dev'));
  expect(maintenanceKey('ha_radio')).not.toBe(maintenanceKey('ha_radio_dev'));
  expect(maintenanceKey('ha_radio_test_' + 'a'.repeat(40)).length).toBeLessThanOrEqual(64);
  expect(() => maintenanceKey('another_database')).toThrow();
});
it('refuses migrations before any connection when stopped-writer confirmation is absent', async () => {
  await expect(migrateDatabase({})).rejects.toThrow();
  await expect(migrateDatabase({ MIGRATION_WRITES_STOPPED: 'false' })).rejects.toThrow();
});
it('rejects a missing client and nonzero exit without forwarding private output', async () => {
  const signal = new AbortController().signal;
  await expect(
    runMaintenanceClient('/nonexistent-haen', [], tmpdir(), {}, signal),
  ).rejects.toThrow();
  await expect(
    runMaintenanceClient(
      process.execPath,
      ['-e', 'console.error("private");process.exit(2)'],
      tmpdir(),
      {},
      signal,
    ),
  ).rejects.toThrow('Database maintenance');
});
it('waits for a cancellation-resistant child to actually terminate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haen-maintenance-'));
  const controller = new AbortController();
  let stopped: Promise<unknown> | undefined;
  try {
    const script = join(root, 'child.mjs'),
      ready = join(root, 'ready');
    await writeFile(
      script,
      'import {writeFileSync} from "node:fs";process.on("SIGTERM",()=>{});writeFileSync(process.argv[2],String(process.pid));setInterval(()=>{},1000);',
    );
    stopped = runMaintenanceClient(
      process.execPath,
      [script, ready],
      root,
      {},
      controller.signal,
      5000,
    ).then(
      () => 'unexpected',
      (error) => error,
    );
    let pid = 0;
    for (let attempt = 0; attempt < 100 && !pid; attempt++) {
      pid = Number(await readFile(ready, 'utf8').catch(() => '0'));
      if (!pid) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(pid).toBeGreaterThan(0);
    controller.abort();
    expect(await stopped).toBeInstanceOf(Error);
    expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    controller.abort();
    await stopped;
    await rm(root, { recursive: true, force: true });
  }
});
