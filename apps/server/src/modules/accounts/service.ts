import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { AccountRepository } from './repository.js';
import { accountSessionExpiry } from './session.js';
import { isReservedUsername, type AccountLibrary, type AccountUser } from '@haen/contracts';

export class AccountError extends Error {
  constructor(
    readonly status: 401 | 403 | 409 | 429,
    readonly code: 'UNAUTHORIZED' | 'FORBIDDEN' | 'ACCOUNT_RESERVED' | 'CONFLICT' | 'RATE_LIMITED',
  ) {
    super(code);
  }
}
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const derive = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt-v1:${salt}:${(await derive(password, salt)).toString('hex')}`;
}
async function verifyPassword(password: string, encoded?: string) {
  const [, salt, expected] = (encoded ?? `scrypt-v1:${'0'.repeat(32)}:${'0'.repeat(128)}`).split(
    ':',
  );
  const actual = await derive(password, salt!);
  return timingSafeEqual(actual, Buffer.from(expected!, 'hex')) && !!encoded;
}
export function createAccountService(repository: AccountRepository) {
  let active = 0;
  const attempts = new Map<string, { count: number; until: number }>();
  function limit(key: string, max: number) {
    const now = Date.now();
    for (const [id, item] of attempts) if (item.until <= now) attempts.delete(id);
    const value = attempts.get(key) ?? { count: 0, until: now + 15 * 60000 };
    if (value.count >= max || (!attempts.has(key) && attempts.size >= 10000))
      throw new AccountError(429, 'RATE_LIMITED');
    value.count++;
    attempts.set(key, value);
  }
  const publicUser = (user: AccountUser): AccountUser => ({ id: user.id, username: user.username });
  return {
    async authenticate(
      credentials: { username: string; password: string },
      ip: string,
      oldToken?: string,
    ) {
      limit(`ip:${digest(ip)}`, 100);
      limit(`name:${credentials.username}`, 12);
      if (active >= 2) throw new AccountError(429, 'RATE_LIMITED');
      active++;
      try {
        if (isReservedUsername(credentials.username))
          throw new AccountError(403, 'ACCOUNT_RESERVED');
        let user = await repository.findUser(credentials.username);
        if (!user) {
          user = {
            id: randomUUID(),
            username: credentials.username,
            passwordHash: await hashPassword(credentials.password),
          };
          try {
            await repository.createUser(user);
          } catch (error) {
            const failure = error as { code?: string; cause?: { code?: string } };
            if (failure.code !== 'ER_DUP_ENTRY' && failure.cause?.code !== 'ER_DUP_ENTRY')
              throw error;
            user = await repository.findUser(credentials.username);
            if (!user || !(await verifyPassword(credentials.password, user.passwordHash)))
              throw new AccountError(401, 'UNAUTHORIZED');
          }
        } else if (!(await verifyPassword(credentials.password, user?.passwordHash)))
          throw new AccountError(401, 'UNAUTHORIZED');
        const token = randomBytes(32).toString('hex');
        await repository.createSession(user!.id, digest(token), accountSessionExpiry());
        if (oldToken) await repository.deleteSession(digest(oldToken));
        return { user: publicUser(user!), token };
      } finally {
        active--;
      }
    },
    async session(token?: string) {
      const user = token
        ? await repository.findSession(digest(token), accountSessionExpiry())
        : undefined;
      return user ? publicUser(user) : null;
    },
    async logout(token?: string) {
      if (token) await repository.deleteSession(digest(token));
    },
    async read(user: AccountUser, expectedId: string) {
      if (user.id !== expectedId) throw new AccountError(401, 'UNAUTHORIZED');
      return repository.readLibrary(user.id);
    },
    async save(user: AccountUser, expectedId: string, value: AccountLibrary) {
      if (user.id !== expectedId) throw new AccountError(401, 'UNAUTHORIZED');
      if (!(await repository.saveLibrary(user.id, value))) throw new AccountError(409, 'CONFLICT');
      return { revision: value.revision + 1, collection: value.collection };
    },
  };
}
export type AccountService = ReturnType<typeof createAccountService>;
