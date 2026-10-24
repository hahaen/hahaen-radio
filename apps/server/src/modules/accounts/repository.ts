import { and, eq, gt, lte, asc, sql } from 'drizzle-orm';
import { AccountCollectionSchema, emptyCollection, type AccountLibrary } from '@haen/contracts';
import type { Database } from '../../db/connection.js';
import { accountUsers, accountSessions, accountLibraries } from '../../db/schema.js';

export interface StoredUser {
  id: string;
  username: string;
  passwordHash: string;
}
export interface AccountRepository {
  findUser(username: string): Promise<StoredUser | undefined>;
  createUser(user: StoredUser): Promise<void>;
  createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  findSession(tokenHash: string, renewUntil: Date): Promise<StoredUser | undefined>;
  deleteSession(tokenHash: string): Promise<void>;
  readLibrary(userId: string): Promise<AccountLibrary>;
  saveLibrary(userId: string, value: AccountLibrary): Promise<boolean>;
}
export function createAccountRepository(database: Database): AccountRepository {
  return {
    findUser: (username) =>
      database.run(
        async (db) =>
          (
            await db.select().from(accountUsers).where(eq(accountUsers.username, username)).limit(1)
          )[0],
      ),
    createUser: (user) =>
      database.run(async (db) =>
        db.transaction(async (tx) => {
          await tx.insert(accountUsers).values({ ...user, createdAt: new Date() });
          await tx
            .insert(accountLibraries)
            .values({ userId: user.id, revision: 0, collection: emptyCollection() });
        }),
      ),
    createSession: (userId, tokenHash, expiresAt) =>
      database.run(async (db) =>
        db.transaction(async (tx) => {
          await tx
            .select({ id: accountUsers.id })
            .from(accountUsers)
            .where(eq(accountUsers.id, userId))
            .for('update');
          await tx.delete(accountSessions).where(lte(accountSessions.expiresAt, new Date()));
          const previous = await tx
            .select()
            .from(accountSessions)
            .where(eq(accountSessions.userId, userId))
            .orderBy(asc(accountSessions.expiresAt));
          for (const session of previous.slice(0, Math.max(0, previous.length - 9)))
            await tx
              .delete(accountSessions)
              .where(eq(accountSessions.tokenHash, session.tokenHash));
          await tx.insert(accountSessions).values({ userId, tokenHash, expiresAt });
        }),
      ),
    findSession: (tokenHash, renewUntil) =>
      database.run(async (db) => {
        // Update existing, unexpired sessions only; concurrent requests cannot shorten the lease.
        await db
          .update(accountSessions)
          .set({
            expiresAt: sql`GREATEST(${accountSessions.expiresAt}, ${sql.param(renewUntil, accountSessions.expiresAt)})`,
          })
          .where(
            and(
              eq(accountSessions.tokenHash, tokenHash),
              gt(accountSessions.expiresAt, new Date()),
            ),
          );
        return (
          await db
            .select({ user: accountUsers })
            .from(accountSessions)
            .innerJoin(accountUsers, eq(accountSessions.userId, accountUsers.id))
            .where(
              and(
                eq(accountSessions.tokenHash, tokenHash),
                gt(accountSessions.expiresAt, new Date()),
              ),
            )
            .limit(1)
        )[0]?.user;
      }),
    deleteSession: (tokenHash) =>
      database.run(async (db) => {
        await db.delete(accountSessions).where(eq(accountSessions.tokenHash, tokenHash));
      }),
    readLibrary: (userId) =>
      database.run(async (db) => {
        const row = (
          await db.select().from(accountLibraries).where(eq(accountLibraries.userId, userId))
        )[0];
        if (!row) throw new Error('ACCOUNT_LIBRARY_MISSING');
        return {
          revision: row.revision,
          collection: AccountCollectionSchema.parse(row.collection),
        };
      }),
    saveLibrary: (userId, value) =>
      database.run(async (db) => {
        const [result] = await db
          .update(accountLibraries)
          .set({ collection: value.collection, revision: value.revision + 1 })
          .where(
            and(eq(accountLibraries.userId, userId), eq(accountLibraries.revision, value.revision)),
          );
        return result.affectedRows === 1;
      }),
  };
}
