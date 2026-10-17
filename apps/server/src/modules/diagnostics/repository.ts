import { and, desc, eq, gt, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { PlaybackReportRequest, PlaybackReportResult } from '@haen/contracts';
import type { Database, DatabaseSession } from '../../db/connection.js';
import { diagnosticLimits, playbackReports } from '../../db/schema.js';

export const REPORT_DAILY_LIMIT = 1000;
export const REPORT_CAPACITY = 10000;
export const REPORT_RETENTION_MS = 7 * 86400000;
export class DiagnosticStoreError extends Error {}
export class DiagnosticConflictError extends Error {}
const LimitSchema = z.object({
  periodDay: z.iso.date(),
  acceptedCount: z.number().int().min(0).max(REPORT_DAILY_LIMIT),
  nextSlot: z
    .number()
    .int()
    .min(0)
    .max(REPORT_CAPACITY - 1),
});
export function diagnosticAllowance(state: z.infer<typeof LimitSchema>, now: Date) {
  const day = now.toISOString().slice(0, 10);
  if (day < state.periodDay) throw new DiagnosticStoreError();
  const used = day === state.periodDay ? state.acceptedCount : 0;
  const retryAfter = Math.max(
    1,
    Math.min(86400, Math.ceil((Date.parse(day + 'T00:00:00Z') + 86400000 - now.getTime()) / 1000)),
  );
  return { day, used, retryAfter };
}
async function databaseNow(session: Pick<DatabaseSession, 'execute'>) {
  const [rows] = await session.execute(
    sql`SELECT UNIX_TIMESTAMP(UTC_TIMESTAMP(3)) * 1000 AS epoch`,
  );
  const [row] = z
    .array(z.object({ epoch: z.coerce.number().positive().max(8640000000000000) }))
    .length(1)
    .parse(rows);
  return new Date(row!.epoch);
}
export function createDiagnosticRepository(database: Database) {
  return {
    record(stationId: string, input: PlaybackReportRequest): Promise<PlaybackReportResult> {
      return database.run((session) =>
        session.transaction(async (tx) => {
          const [row] = await tx
            .select()
            .from(diagnosticLimits)
            .where(eq(diagnosticLimits.id, 1))
            .for('update');
          const state = LimitSchema.parse(row);
          const now = await databaseNow(tx);
          await tx.delete(playbackReports).where(lte(playbackReports.expiresAt, now));
          const [existing] = await tx
            .select()
            .from(playbackReports)
            .where(eq(playbackReports.reportId, input.reportId));
          if (existing) {
            if (
              existing.stationId !== stationId ||
              existing.streamId !== input.streamId ||
              existing.failure !== input.failure
            )
              throw new DiagnosticConflictError();
            return {
              status: 'accepted' as const,
              reportId: existing.reportId,
              stationId,
              streamId: existing.streamId,
              expiresAt: existing.expiresAt.toISOString(),
            };
          }
          const allowance = diagnosticAllowance(state, now);
          if (allowance.used >= REPORT_DAILY_LIMIT)
            return { status: 'limited' as const, retryAfter: allowance.retryAfter };
          const expiresAt = new Date(now.getTime() + REPORT_RETENTION_MS);
          const values = {
            reportId: input.reportId,
            stationId,
            streamId: input.streamId,
            failure: input.failure,
            createdAt: now,
            expiresAt,
          };
          await tx
            .insert(playbackReports)
            .values({ slot: state.nextSlot, ...values })
            .onDuplicateKeyUpdate({ set: values });
          await tx
            .update(diagnosticLimits)
            .set({
              periodDay: allowance.day,
              acceptedCount: allowance.used + 1,
              nextSlot: (state.nextSlot + 1) % REPORT_CAPACITY,
            })
            .where(eq(diagnosticLimits.id, 1));
          return {
            status: 'accepted' as const,
            reportId: input.reportId,
            stationId,
            streamId: input.streamId,
            expiresAt: expiresAt.toISOString(),
          };
        }),
      );
    },
    cleanup() {
      return database.run(async (session) => {
        const now = await databaseNow(session);
        const [result] = await session
          .delete(playbackReports)
          .where(lte(playbackReports.expiresAt, now));
        return result.affectedRows;
      });
    },
    summary() {
      return database.run(async (session) => {
        const now = await databaseNow(session);
        return session
          .select({
            stationId: playbackReports.stationId,
            streamId: playbackReports.streamId,
            failure: playbackReports.failure,
            count: sql<number>`COUNT(*)`,
            latest: sql<string>`MAX(${playbackReports.createdAt})`,
          })
          .from(playbackReports)
          .where(and(gt(playbackReports.expiresAt, now), lte(playbackReports.createdAt, now)))
          .groupBy(playbackReports.stationId, playbackReports.streamId, playbackReports.failure)
          .orderBy(
            desc(sql`COUNT(*)`),
            playbackReports.stationId,
            playbackReports.streamId,
            playbackReports.failure,
          )
          .limit(20);
      });
    },
  };
}
export type DiagnosticRepository = ReturnType<typeof createDiagnosticRepository>;
