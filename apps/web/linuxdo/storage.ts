import type { MiniAppSDK } from '@discourse-mini-app/sdk';
import type { StationPreview } from '@haen/contracts';
import { z } from 'zod';
import { saveStation } from '../src/library/model';
import { createLibrary, LIBRARY_PREFIX } from '../src/library/store';

const storageKey = 'haen:ld:library:v1';
const legacyKey = 'haen:ld:favorites:v1';
const languageKey = 'haen:ld:language:v1';
const records = z.record(z.string().startsWith(LIBRARY_PREFIX), z.string());

export async function loadStorage(
  sdk: MiniAppSDK,
  stations: (ids: string[]) => Promise<StationPreview[]>,
) {
  const events = new EventTarget();
  const get = (key: string) => sdk.localStorage.getItem(key);
  const set = (key: string, value: string) => sdk.localStorage.setItem(key, value);
  let writable = sdk.permissions.has('storage.read') && sdk.permissions.has('storage.write');
  let data = new Map<string, string>();
  let language: 'zh' | 'en' | undefined;
  if (sdk.permissions.has('storage.read')) {
    try {
      const [raw, savedLanguage] = await Promise.all([get(storageKey), get(languageKey)]);
      if (raw !== null) {
        data = new Map(Object.entries(records.parse(JSON.parse(raw))));
      } else {
        const legacy = z.array(z.uuid()).parse(JSON.parse((await get(legacyKey)) ?? '[]'));
        if (legacy.length) {
          for (const detail of await stations([...new Set(legacy)])) {
            data.set(
              LIBRARY_PREFIX + 'favorite:' + detail.id,
              JSON.stringify({ version: 1, value: saveStation(detail, 0) }),
            );
          }
        }
      }
      if (savedLanguage === 'zh' || savedLanguage === 'en') language = savedLanguage;
    } catch {
      // Leave unreadable stored values intact.
      writable = false;
    }
  }
  let writes = Promise.resolve();
  function persist() {
    if (!writable) throw new Error('Storage unavailable');
    writes = writes
      .then(async () => {
        if (writable) await set(storageKey, JSON.stringify(Object.fromEntries(data)));
      })
      .catch(() => {
        writable = false;
        events.dispatchEvent(new Event('write-failed'));
      });
  }
  const storage = {
    get length() {
      return data.size;
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem(key: string, value: string) {
      data.set(key, value);
      persist();
    },
    removeItem(key: string) {
      data.delete(key);
      persist();
    },
  };
  return {
    language,
    async saveLanguage(value: 'zh' | 'en') {
      if (!writable) return false;
      try {
        await set(languageKey, value);
        return true;
      } catch {
        return false;
      }
    },
    createLibrary() {
      const library = createLibrary({ storage: () => storage, events });
      events.addEventListener('write-failed', () =>
        library.store.setState({ storageProblem: 'unavailable' }),
      );
      if (!writable) library.store.setState({ storageProblem: 'unavailable' });
      return library;
    },
  };
}
