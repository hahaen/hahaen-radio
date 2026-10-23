import { emptyCollection, type AccountLibrary } from '@haen/contracts';
import type { AccountRepository, StoredUser } from '../modules/accounts/repository.js';
export function memoryAccountRepository() {
  const users = new Map<string, StoredUser>();
  const sessions = new Map<string, { userId: string; expiresAt: Date }>();
  const libraries = new Map<string, AccountLibrary>();
  const repository: AccountRepository = {
    async findUser(username) {
      return [...users.values()].find((user) => user.username === username);
    },
    async createUser(user) {
      if ([...users.values()].some((item) => item.username === user.username))
        throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
      users.set(user.id, user);
      libraries.set(user.id, { revision: 0, collection: emptyCollection() });
    },
    async createSession(userId, tokenHash, expiresAt) {
      sessions.set(tokenHash, { userId, expiresAt });
    },
    async findSession(tokenHash) {
      const value = sessions.get(tokenHash);
      return value && value.expiresAt > new Date() ? users.get(value.userId) : undefined;
    },
    async deleteSession(tokenHash) {
      sessions.delete(tokenHash);
    },
    async readLibrary(id) {
      return structuredClone(libraries.get(id)!);
    },
    async saveLibrary(id, value) {
      if (libraries.get(id)?.revision !== value.revision) return false;
      libraries.set(id, {
        revision: value.revision + 1,
        collection: structuredClone(value.collection),
      });
      return true;
    },
  };
  return { repository, users, sessions, libraries };
}
