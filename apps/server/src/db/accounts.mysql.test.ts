import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { emptyCollection } from '@haen/contracts';
import { readDatabaseConfig } from '../config/database.js';
import { openDatabase, type Database } from './connection.js';
import { accountLibraries, accountSessions, accountUsers } from './schema.js';
import { createAccountRepository } from '../modules/accounts/repository.js';
import { createAccountService } from '../modules/accounts/service.js';
describe.skipIf(process.env.HAEN_MYSQL_TESTS !== '1')('isolated MySQL accounts', () => {
  let database: Database;
  beforeAll(async () => {
    database = await openDatabase(readDatabaseConfig());
  });
  afterAll(async () => {
    await database?.close();
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
      favorites: [{ id: randomUUID(), name: '测试电台 🌊', countryCode: 'CN', savedAt: 1 }],
    };
    const results = await Promise.all([
      repository.saveLibrary(account.user.id, { revision: 0, collection }),
      repository.saveLibrary(account.user.id, { revision: 0, collection: emptyCollection() }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await repository.readLibrary(account.user.id)).revision).toBe(1);
    await repository.createSession(account.user.id, 'a'.repeat(64), new Date(0));
    expect(await repository.findSession('a'.repeat(64))).toBeUndefined();
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
