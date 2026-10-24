import { GuestImportSchema, guestStamp, newGuestItems, type GuestImport } from './import';
import { createStore } from 'zustand/vanilla';
import { z } from 'zod';
import {
  AccountSessionSchema,
  AccountLibrarySchema,
  AccountCollectionSchema,
  emptyCollection,
  type AccountUser,
  type AccountLibrary,
  type AccountCollection,
} from '@haen/contracts';
import { getJson, HttpError } from '../services/http';
import type { Library } from '../library/store';
import { collectionOf, mergeCollection, sameCollection } from './sync';
const CacheSchema = z.strictObject({
  base: AccountLibrarySchema,
  current: AccountCollectionSchema,
  guestImport: GuestImportSchema.nullable(),
});
export interface AccountState {
  user: AccountUser | null;
  status: 'checking' | 'guest' | 'syncing' | 'synced' | 'error' | 'expired';
  busy: boolean;
  error: string | null;
  cacheUnavailable: boolean;
}
export function createAccountController(library: Library, request = getJson) {
  const store = createStore<AccountState>(() => ({
    user: null,
    status: 'checking',
    busy: false,
    error: null,
    cacheUnavailable: false,
  }));
  let base: AccountLibrary | null = null;
  let guestImport: GuestImport | null = null;
  let applying = false,
    generation = 0;
  let pending: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cacheKey = (id: string) => `haen:account-pending:v1:${id}`;
  const importKey = (id: string) => `haen:guest-import:v1:${id}`;
  function persist() {
    const user = store.getState().user;
    if (!user || !base) return;
    try {
      // One atomic tab-local record retains unsent changes across reloads, never credentials.
      sessionStorage.setItem(
        cacheKey(user.id),
        JSON.stringify({ base, current: collectionOf(library.store.getState()), guestImport }),
      );
    } catch {
      store.setState({ cacheUnavailable: true });
    }
  }
  function apply(collection: AccountCollection | null) {
    applying = true;
    library.setAccountCollection(collection);
    applying = false;
  }
  function fail(error: unknown) {
    if (error instanceof HttpError && error.status === 401) {
      persist();
      generation++;
      base = null;
      store.setState({ user: null, status: 'expired', error: 'expired' });
      apply(null);
    } else
      store.setState({
        status: 'error',
        error: error instanceof HttpError ? error.code : 'NETWORK',
      });
  }
  async function enter(user: AccountUser) {
    const epoch = ++generation;
    const remote = await request(
      `/account/library?userId=${encodeURIComponent(user.id)}`,
      AccountLibrarySchema,
    );
    if (epoch !== generation) return;
    let current = remote.collection;
    let cachedImport: GuestImport | null = null;
    let text: string | null = null;
    try {
      text = sessionStorage.getItem(cacheKey(user.id));
    } catch {
      store.setState({ cacheUnavailable: true });
    }
    try {
      if (text) {
        const saved = CacheSchema.parse(JSON.parse(text));
        cachedImport = saved.guestImport;
        current = mergeCollection(saved.base.collection, saved.current, remote.collection);
      }
    } catch {
      // Never silently overwrite an unreadable pending collection.
      store.setState({ error: 'CACHE', status: 'error' });
      throw new Error('ACCOUNT_CACHE_UNREADABLE');
    }
    const guest = library.guestCollection();
    let imported: GuestImport = { favorites: {}, songs: {}, history: {} };
    try {
      const marker = localStorage.getItem(importKey(user.id));
      if (marker) imported = GuestImportSchema.parse(JSON.parse(marker));
    } catch {
      store.setState({ cacheUnavailable: true });
    }
    current = mergeCollection(
      emptyCollection(),
      newGuestItems(guest, cachedImport ?? imported),
      current,
    );
    guestImport = guestStamp(guest);
    base = remote;
    store.setState({ user, status: 'syncing', error: null });
    apply(current);
    persist();
    if (pending) await pending;
    await sync();
  }
  async function synchronize() {
    const user = store.getState().user;
    if (!user || !base) return;
    const epoch = generation;
    store.setState({ status: 'syncing', error: null });
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        const remote = await request(
          `/account/library?userId=${encodeURIComponent(user.id)}`,
          AccountLibrarySchema,
        );
        if (epoch !== generation || !base) return;
        const current = collectionOf(library.store.getState());
        const merged = mergeCollection(base.collection, current, remote.collection);
        let saved = remote;
        if (!sameCollection(merged, remote.collection)) {
          try {
            saved = await request('/account/library', AccountLibrarySchema, undefined, {
              method: 'POST',
              body: { userId: user.id, revision: remote.revision, collection: merged },
              timeoutMs: 30000,
            });
          } catch (error) {
            if (error instanceof HttpError && error.status === 409) continue;
            throw error;
          }
        }
        if (epoch !== generation) return;
        const next = mergeCollection(
          current,
          collectionOf(library.store.getState()),
          saved.collection,
        );
        base = saved;
        apply(next);
        persist();
        if (sameCollection(next, saved.collection)) {
          if (guestImport) {
            try {
              localStorage.setItem(importKey(user.id), JSON.stringify(guestImport));
              guestImport = null;
              persist();
            } catch {
              store.setState({ cacheUnavailable: true });
            }
          }
          store.setState({ status: 'synced', error: null });
          return;
        }
      }
      throw new Error('SYNC_BUSY');
    } catch (error) {
      if (epoch === generation) fail(error);
    }
  }
  function sync(): Promise<void> {
    if (pending) return pending;
    pending = synchronize().finally(() => {
      pending = null;
    });
    return pending;
  }
  return {
    store,
    sync,
    attach() {
      const off = library.store.subscribe((state, previous) => {
        if (
          applying ||
          (state.favorites === previous.favorites &&
            state.songs === previous.songs &&
            state.history === previous.history) ||
          !base ||
          !store.getState().user ||
          sameCollection(collectionOf(state), collectionOf(previous))
        )
          return;
        persist();
        store.setState({ status: 'syncing' });
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          void sync();
        }, 400);
      });
      let live = true,
        restoring = false,
        restorePending = true;
      const initialize = async () => {
        if (restoring) return;
        restoring = true;
        const epoch = generation;
        try {
          const result = await request('/account/session', AccountSessionSchema);
          if (!live || epoch !== generation) return;
          if (result.user) await enter(result.user);
          else store.setState({ status: 'guest' });
          restorePending = false;
        } catch {
          if (live && !store.getState().user && store.getState().status === 'checking')
            store.setState({ status: 'guest' });
        } finally {
          restoring = false;
        }
      };
      void initialize();
      const refresh = () => {
        if (document.visibilityState === 'hidden') return;
        if (restorePending && !store.getState().user) void initialize();
        else void sync();
      };
      const interval = setInterval(refresh, 30000);
      window.addEventListener('online', refresh);
      window.addEventListener('focus', refresh);
      document.addEventListener('visibilitychange', refresh);
      const leaving = (event: BeforeUnloadEvent) => {
        if (base && !sameCollection(base.collection, collectionOf(library.store.getState()))) {
          event.preventDefault();
          event.returnValue = '';
        }
      };
      window.addEventListener('beforeunload', leaving);
      return () => {
        live = false;
        generation++;
        off();
        clearInterval(interval);
        if (timer) clearTimeout(timer);
        window.removeEventListener('online', refresh);
        window.removeEventListener('focus', refresh);
        document.removeEventListener('visibilitychange', refresh);
        window.removeEventListener('beforeunload', leaving);
      };
    },
    async authenticate(username: string, password: string) {
      if (store.getState().busy) return;
      store.setState({ busy: true, error: null });
      try {
        const result = await request('/account/login', AccountSessionSchema, undefined, {
          method: 'POST',
          body: { username, password },
          timeoutMs: 30000,
        });
        if (result.user) await enter(result.user);
      } catch (error) {
        store.setState({
          error: error instanceof HttpError ? error.code : (store.getState().error ?? 'NETWORK'),
        });
      } finally {
        store.setState({ busy: false });
      }
    },
    async logout() {
      if (store.getState().busy) return;
      store.setState({ busy: true, error: null });
      try {
        await sync();
        const user = store.getState().user;
        if (!user) return;
        if (store.getState().status !== 'synced') {
          store.setState({ error: 'UNSENT' });
          return;
        }
        await request('/account/logout', AccountSessionSchema, undefined, {
          method: 'POST',
          body: { userId: user.id },
        });
        persist();
        if (base && sameCollection(base.collection, collectionOf(library.store.getState()))) {
          try {
            sessionStorage.removeItem(cacheKey(user.id));
          } catch {
            /* Private storage may be unavailable. */
          }
        }
        generation++;
        base = null;
        apply(null);
        store.setState({ user: null, status: 'guest', error: null });
      } catch (error) {
        fail(error);
      } finally {
        store.setState({ busy: false });
      }
    },
  };
}
export type AccountController = ReturnType<typeof createAccountController>;
