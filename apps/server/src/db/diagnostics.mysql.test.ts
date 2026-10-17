import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { readDatabaseConfig } from '../config/database.js';
import { openDatabase, type Database } from './connection.js';
import { diagnosticLimits, playbackReports } from './schema.js';
import {
  createDiagnosticRepository,
  DiagnosticConflictError,
} from '../modules/diagnostics/repository.js';

const stationId = '00000000-0000-4000-8000-000000000001',
  streamId = 'a'.repeat(24);
const input = () => ({ reportId: randomUUID(), streamId, failure: 'network' as const });
describe.skipIf(process.env.HAEN_MYSQL_TESTS !== '1')('isolated MySQL diagnostic storage', () => {
  let database: Database;
  beforeAll(async () => {
    if (process.env.NODE_ENV !== 'test') throw new Error('Test environment required');
    database = await openDatabase(readDatabaseConfig());
  });
  afterAll(async () => {
    await database?.close();
  });
  beforeEach(async () => {
    await database.run(async (session) => {
      await session.delete(playbackReports);
      await session
        .update(diagnosticLimits)
        .set({ periodDay: '1970-01-01', acceptedCount: 0, nextSlot: 0 })
        .where(eq(diagnosticLimits.id, 1));
    });
  });
  it('deduplicates a receipt across repository restarts, rejects conflicting content and keeps quota and report writes atomic', async () => {
    const repository = createDiagnosticRepository(database),
      request = input();
    const first = await repository.record(stationId, request);
    expect(first.status).toBe('accepted');
    expect(await createDiagnosticRepository(database).record(stationId, request)).toEqual(first);
    await expect(repository.record(stationId, { ...request, failure: 'offline' })).rejects.toThrow(
      DiagnosticConflictError,
    );
    const rows = await database.run((session) => session.select().from(playbackReports));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.expiresAt.getTime() - rows[0]!.createdAt.getTime()).toBe(7 * 86400000);
    expect(
      (await database.run((session) => session.select().from(diagnosticLimits)))[0]!.acceptedCount,
    ).toBe(1);
    await promisify(execFile)(
      process.execPath,
      ['node_modules/drizzle-kit/bin.cjs', 'migrate', '--config=drizzle.test.config.ts'],
      {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        env: {
          ...process.env,
          DB_TEST_MIGRATIONS_PATH: fileURLToPath(new URL('../../migrations', import.meta.url)),
        },
        timeout: 120000,
        maxBuffer: 128 * 1024,
      },
    );
    expect(
      (await database.run((session) => session.select().from(diagnosticLimits)))[0]!.acceptedCount,
    ).toBe(1);
    await expect(
      database.run((session) =>
        session.transaction(async (tx) => {
          await tx
            .update(diagnosticLimits)
            .set({ acceptedCount: 2 })
            .where(eq(diagnosticLimits.id, 1));
          await tx
            .insert(playbackReports)
            .values({ ...rows[0]!, slot: 1, reportId: randomUUID(), failure: 'invalid' });
        }),
      ),
    ).rejects.toThrow();
    expect(
      (await database.run((session) => session.select().from(diagnosticLimits)))[0]!.acceptedCount,
    ).toBe(1);
  });
  it('enforces the last daily slot under concurrent writers and retains exhaustion across process-local repository replacement', async () => {
    await createDiagnosticRepository(database).record(stationId, input());
    await database.run((session) =>
      session
        .update(diagnosticLimits)
        .set({ acceptedCount: 999 })
        .where(eq(diagnosticLimits.id, 1)),
    );
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        createDiagnosticRepository(database).record(stationId, input()),
      ),
    );
    expect(results.filter((r) => r.status === 'accepted')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'limited')).toHaveLength(3);
    expect((await createDiagnosticRepository(database).record(stationId, input())).status).toBe(
      'limited',
    );
  });
  it('overwrites only a fixed-capacity slot without growing storage beyond 10000 rows', async () => {
    const now = new Date(),
      expiresAt = new Date(now.getTime() + 7 * 86400000);
    for (let start = 0; start < 10000; start += 1000)
      await database.run((session) =>
        session.insert(playbackReports).values(
          Array.from({ length: 1000 }, (_, offset) => ({
            slot: start + offset,
            reportId: '00000000-0000-4000-8000-' + String(start + offset).padStart(12, '0'),
            stationId,
            streamId,
            failure: 'network',
            createdAt: now,
            expiresAt,
          })),
        ),
      );
    const request = input();
    await createDiagnosticRepository(database).record(stationId, request);
    const [count] = await database.run((session) =>
      session.select({ count: sql<number>`COUNT(*)` }).from(playbackReports),
    );
    expect(Number(count!.count)).toBe(10000);
    expect(
      (
        await database.run((session) =>
          session.select().from(playbackReports).where(eq(playbackReports.slot, 0)),
        )
      )[0]!.reportId,
    ).toBe(request.reportId);
  });
  it('filters expired records from operator summaries and deletes only expired data without resetting the daily allowance', async () => {
    const repository = createDiagnosticRepository(database);
    await repository.record(stationId, input());
    const createdAt = new Date(Date.now() - 8 * 86400000),
      expiresAt = new Date(createdAt.getTime() + 7 * 86400000);
    await database.run((session) =>
      session.insert(playbackReports).values({
        slot: 9999,
        reportId: randomUUID(),
        stationId,
        streamId,
        failure: 'offline',
        createdAt,
        expiresAt,
      }),
    );
    expect(await repository.summary()).toHaveLength(1);
    expect(await repository.cleanup()).toBe(1);
    expect(await repository.cleanup()).toBe(0);
    expect(
      (await database.run((session) => session.select().from(diagnosticLimits)))[0]!.acceptedCount,
    ).toBe(1);
  });
});
