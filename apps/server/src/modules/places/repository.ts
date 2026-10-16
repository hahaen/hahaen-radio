import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../../db/connection.js';
import { jobLeases, jobRuns, places } from '../../db/schema.js';
import { PlaceSchema, type Place } from './geonames.js';

export async function readPlaces(database: Database, signal?: AbortSignal): Promise<Place[]> {
  const deadline = AbortSignal.timeout(90000);
  const active = signal ? AbortSignal.any([signal, deadline]) : deadline;
  active.throwIfAborted();
  const snapshot = await database.run((session) =>
    session.transaction(
      async (tx) => {
        const [first] = await tx
          .select({ version: places.importedAt })
          .from(places)
          .orderBy(asc(places.id))
          .limit(1);
        if (!first) return null;
        const [all] = await tx.select({ count: sql<number>`COUNT(*)` }).from(places);
        const [version] = await tx
          .select({ count: sql<number>`COUNT(*)` })
          .from(places)
          .where(eq(places.importedAt, first.version));
        if (Number(all?.count) > 100000 || Number(all?.count) !== Number(version?.count))
          throw new Error('PLACES_INVALID_SNAPSHOT');
        return { version: first.version, count: Number(all?.count) };
      },
      { isolationLevel: 'repeatable read' },
    ),
  );
  if (!snapshot) return [];
  const result: Place[] = [];
  let after = 0;
  while (result.length < snapshot.count) {
    active.throwIfAborted();
    const batch = await database.run((session) =>
      session
        .select()
        .from(places)
        .where(and(eq(places.importedAt, snapshot.version), gt(places.id, after)))
        .orderBy(asc(places.id))
        .limit(1000),
    );
    active.throwIfAborted();
    if (!batch.length) throw new Error('PLACES_SNAPSHOT_CHANGED');
    result.push(...z.array(PlaceSchema).max(1000).parse(batch));
    if (result.length > snapshot.count) throw new Error('PLACES_INVALID_SNAPSHOT');
    after = batch.at(-1)!.id;
  }
  return result;
}
export async function replacePlaces(database: Database, input: Place[], signal?: AbortSignal) {
  const rows = z.array(PlaceSchema).min(1000).max(100000).parse(input);
  if (new Set(rows.map((row) => row.id)).size !== rows.length)
    throw new Error('PLACES_DUPLICATE_ID');
  const token = randomUUID();
  const startedAt = new Date();
  try {
    await database.run((session) =>
      session.transaction(async (tx) => {
        signal?.throwIfAborted();
        // All rows and the successful run record become visible in one commit.
        await tx
          .insert(jobLeases)
          .ignore()
          .values({ name: 'places-import', token, expiresAt: new Date(0) });
        await tx.select().from(jobLeases).where(eq(jobLeases.name, 'places-import')).for('update');
        await tx
          .update(jobLeases)
          .set({ token, expiresAt: sql`DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 2 MINUTE)` })
          .where(eq(jobLeases.name, 'places-import'));
        const [previous] = await tx
          .select({ version: places.importedAt })
          .from(places)
          .orderBy(asc(places.id))
          .limit(1)
          .for('update');
        // Serialize and advance the snapshot marker even when two import callers start in one ms.
        const importedAt = new Date(Math.max(Date.now(), (previous?.version.getTime() ?? 0) + 1));
        await tx.delete(places);
        for (let offset = 0; offset < rows.length; offset += 2000) {
          signal?.throwIfAborted();
          await tx
            .insert(places)
            .values(rows.slice(offset, offset + 2000).map((row) => ({ ...row, importedAt })));
        }
        signal?.throwIfAborted();
        await tx.insert(jobRuns).values({
          id: token,
          name: 'places-import',
          status: 'succeeded',
          startedAt,
          finishedAt: sql`UTC_TIMESTAMP(3)`,
          processedCount: rows.length,
        });
        await tx
          .update(jobLeases)
          .set({ expiresAt: sql`UTC_TIMESTAMP(3)` })
          .where(eq(jobLeases.name, 'places-import'));
        signal?.throwIfAborted();
      }),
    );
    return { status: 'imported' as const, count: rows.length };
  } catch (error) {
    await database
      .run(async (session) => {
        await session.insert(jobRuns).values({
          id: token,
          name: 'places-import',
          status: 'failed',
          startedAt,
          finishedAt: sql`UTC_TIMESTAMP(3)`,
          errorCode: 'PLACES_IMPORT_FAILED',
        });
      })
      .catch(() => {});
    throw error;
  }
}
