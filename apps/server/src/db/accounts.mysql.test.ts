import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { emptyCollection } from '@haen/contracts';
import { readDatabaseConfig } from '../config/database.js';
import { openDatabase, type Database } from './connection.js';
import { accountLibraries, accountSessions, accountUsers } from './schema.js';
import { createAccountRepository } from '../modules/accounts/repository.js';
import { createAccountService } from '../modules/accounts/service.js';
import { accountSessionExpiry } from '../modules/accounts/session.js';
describe.skipIf(process.env.HAEN_MYSQL_TESTS !== '1')('isolated MySQL accounts', () => {
  let database: Database;
  beforeAll(async () => {
    database = await openDatabase(readDatabaseConfig());
  });
  afterAll(async () => {
    await database?.close();
  });
  it('atomically renews valid legacy sessions without shortening, reviving or recreating them', async () => {
    const repository = createAccountRepository(database);
    const user = {
      id: randomUUID(),
      username: 'sliding_' + randomBytes(8).toString('hex'),
      passwordHash: 'test-only',
    };
    await repository.createUser(user);
    const tokenHash = randomBytes(32).toString('hex');
    const expiredHash = randomBytes(32).toString('hex');
    try {
      await repository.createSession(user.id, tokenHash, new Date(Date.now() + 86400000));
      const later = accountSessionExpiry();
      const earlier = new Date(later.getTime() - 86400000);
      await Promise.all([
        repository.findSession(tokenHash, later),
        repository.findSession(tokenHash, earlier),
      ]);
      const rows = await database.run((db) =>
        db.select().from(accountSessions).where(eq(accountSessions.tokenHash, tokenHash)),
      );
      expect(rows[0]!.expiresAt).toEqual(later);
      await repository.createSession(user.id, expiredHash, new Date(0));
      expect(await repository.findSession(expiredHash, later)).toBeUndefined();
      const expired = await database.run((db) =>
        db.select().from(accountSessions).where(eq(accountSessions.tokenHash, expiredHash)),
      );
      expect(expired[0]!.expiresAt).toEqual(new Date(0));
      await repository.deleteSession(tokenHash);
      expect(await repository.findSession(tokenHash, later)).toBeUndefined();
      expect(
        await database.run((db) =>
          db.select().from(accountSessions).where(eq(accountSessions.tokenHash, tokenHash)),
        ),
      ).toHaveLength(0);
    } finally {
      await database.run((db) => db.delete(accountUsers).where(eq(accountUsers.id, user.id)));
    }
  });
  it('persists accounts and sessions across service instances, enforces uniqueness and optimistic writes, cascades deletion', async () => {
    const repository = createAccountRepository(database);
    const service = createAccountService(repository);
    const username = 'listener_' + randomBytes(8).toString('hex');
    const credentials = { username, password: randomBytes(24).toString('hex') };
    const account = await service.authenticate(credentials, '127.0.0.1');
    expect(
      await createAccountService(createAccountRepository(database)).session(account.token),
    ).toEqual(account.user);
    await expect(
      repository.createUser({ id: randomUUID(), username, passwordHash: 'test-only' }),
    ).rejects.toThrow();
    const collection = {
      ...emptyCollection(),
      pinned: true,
      favorites: [{ id: randomUUID(), name: '测试电台 🌊', countryCode: 'CN', savedAt: 1 }],
    };
    const results = await Promise.all([
      repository.saveLibrary(account.user.id, { revision: 0, collection }),
      repository.saveLibrary(account.user.id, { revision: 0, collection: emptyCollection() }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await repository.readLibrary(account.user.id)).revision).toBe(1);
    const stored = await repository.readLibrary(account.user.id);
    await service.save(account.user, account.user.id, {
      revision: stored.revision,
      collection: { ...emptyCollection(), pinned: true },
    });
    expect((await repository.readLibrary(account.user.id)).collection.pinned).toBe(true);
    await service.save(account.user, account.user.id, {
      revision: stored.revision + 1,
      collection: emptyCollection(),
    });
    expect((await repository.readLibrary(account.user.id)).collection.pinned).toBe(true);
    await service.save(account.user, account.user.id, {
      revision: stored.revision + 2,
      collection: { ...emptyCollection(), pinned: false },
    });
    expect((await repository.readLibrary(account.user.id)).collection.pinned).toBe(false);
    await repository.createSession(account.user.id, 'a'.repeat(64), new Date(0));
    expect(
      await repository.findSession('a'.repeat(64), new Date(Date.now() + 30 * 86400000)),
    ).toBeUndefined();
    const login = await service.authenticate(credentials, '127.0.0.1', account.token);
    expect(await service.session(account.token)).toBeNull();
    await service.logout(login.token);
    expect(await service.session(login.token)).toBeNull();
    await database.run(async (db) => {
      await db.delete(accountUsers).where(eq(accountUsers.id, account.user.id));
    });
    expect(
      await database.run((db) =>
        db.select().from(accountLibraries).where(eq(accountLibraries.userId, account.user.id)),
      ),
    ).toHaveLength(0);
    expect(
      await database.run((db) =>
        db.select().from(accountSessions).where(eq(accountSessions.userId, account.user.id)),
      ),
    ).toHaveLength(0);
  });
});
