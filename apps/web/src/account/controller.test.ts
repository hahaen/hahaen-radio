import { beforeEach, describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';
import { z } from 'zod';
import { emptyCollection, type AccountLibrary } from '@haen/contracts';
import { createLibrary, LIBRARY_PREFIX } from '../library/store';
import { createAccountController } from './controller';
import { HttpError, type getJson } from '../services/http';
import { testStation } from '../testing/stations';
const user = { id: '00000000-0000-4000-8000-000000000099', username: 'listener_alpha' };
function setup() {
  let signedIn = false,
    offline = false;
  let remote: AccountLibrary = { revision: 0, collection: emptyCollection() };
  const calls: string[] = [];
  const request = (async (
    path: string,
    schema: z.ZodType,
    _signal?: AbortSignal,
    options?: { body: unknown },
  ) => {
    calls.push(path);
    if (offline) throw new Error('offline');
    if (path.endsWith('/login')) {
      signedIn = true;
      return schema.parse({ user });
    }
    if (path.endsWith('/session')) return schema.parse({ user: signedIn ? user : null });
    if (!signedIn) throw new HttpError(401, 'UNAUTHORIZED');
    if (path.endsWith('/logout')) {
      signedIn = false;
      return schema.parse({ user: null });
    }
    if (options) {
      const body = options.body as AccountLibrary;
      remote = { revision: body.revision + 1, collection: body.collection };
    }
    return schema.parse(structuredClone(remote));
  }) as typeof getJson;
  const library = createLibrary();
  const account = createAccountController(library, request);
  return {
    library,
    account,
    request,
    calls,
    remote: () => remote,
    offline: (value: boolean) => {
      offline = value;
    },
    expire: () => {
      signedIn = false;
    },
  };
}
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
describe('optional account controller', () => {
  it('keeps guests local, automatically merges once per account, saves removals and restores guests after logout', async () => {
    const { account, library, remote, calls } = setup();
    library.toggleFavorite(testStation(1));
    const original = localStorage.getItem(LIBRARY_PREFIX + 'favorite:' + testStation(1).id);
    const detach = account.attach();
    try {
      await waitFor(() => expect(account.store.getState().status).toBe('guest'));
      expect(calls).toEqual(['/account/session']);
      await account.authenticate('listener_alpha', 'unused-generated-by-server-tests');
      expect(library.store.getState().favorites).toHaveLength(1);
      expect(remote().collection.favorites).toHaveLength(1);
      library.toggleFavorite(testStation(1));
      await account.sync();
      expect(remote().collection.favorites).toHaveLength(0);
      await account.logout();
      expect(library.store.getState().favorites).toHaveLength(1);
      await account.authenticate('listener_alpha', 'unused-generated-by-server-tests');
      expect(remote().collection.favorites).toHaveLength(0);
      await account.logout();
      expect(localStorage.getItem(LIBRARY_PREFIX + 'favorite:' + testStation(1).id)).toBe(original);
    } finally {
      detach();
    }
  });
  it('retains failed sync across reload and hides expired account data without mixing into guest data', async () => {
    const state = setup();
    const detach = state.account.attach();
    try {
      await waitFor(() => expect(state.account.store.getState().status).toBe('guest'));
      await state.account.authenticate('listener_alpha', 'unused-generated-by-server-tests');
      state.offline(true);
      state.library.toggleFavorite(testStation(2));
      await state.account.sync();
      expect(state.account.store.getState().status).toBe('error');
      await state.account.logout();
      expect(state.account.store.getState().user).toEqual(user);
      state.offline(false);
      state.expire();
      await state.account.sync();
      expect(state.account.store.getState().status).toBe('expired');
      expect(state.library.store.getState().favorites).toHaveLength(0);
      await state.account.authenticate('listener_alpha', 'unused-generated-by-server-tests');
      expect(state.remote().collection.favorites[0]?.id).toBe(testStation(2).id);
    } finally {
      detach();
    }
  });
  it('retries pending account edits after a tab reload', async () => {
    const state = setup();
    const detach = state.account.attach();
    await waitFor(() => expect(state.account.store.getState().status).toBe('guest'));
    await state.account.authenticate('listener_alpha', 'unused-generated-by-server-tests');
    state.offline(true);
    state.library.toggleFavorite(testStation(3));
    await state.account.sync();
    detach();
    state.offline(false);
    const restoredLibrary = createLibrary();
    const restored = createAccountController(restoredLibrary, state.request);
    const off = restored.attach();
    try {
      await waitFor(() => expect(restored.store.getState().status).toBe('synced'));
      expect(state.remote().collection.favorites[0]?.id).toBe(testStation(3).id);
      expect(restoredLibrary.store.getState().favorites[0]?.id).toBe(testStation(3).id);
    } finally {
      off();
    }
  });
  it('preserves guest memory-only collections when storage is unavailable', () => {
    const library = createLibrary({
      storage: () => {
        throw new Error('blocked');
      },
    });
    library.toggleFavorite(testStation(1));
    library.setAccountCollection(emptyCollection());
    expect(library.guestCollection().favorites).toHaveLength(1);
    library.setAccountCollection(null);
    expect(library.store.getState().favorites).toHaveLength(1);
  });
});
