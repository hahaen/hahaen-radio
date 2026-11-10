import type { MiniAppSDK } from '@discourse-mini-app/sdk';
import { decodeSceneEntry, type StationDetail } from '@haen/contracts';
import { HttpError } from '../src/services/http';
import { snapshotSchema } from './schemas';

export async function createCatalog(sdk: MiniAppSDK) {
  const snapshot = snapshotSchema.parse(
    await sdk.assets.readJson('data/catalog.json', { timeoutMs: 30000 }),
  );
  const stations = snapshot.stations.map(decodeSceneEntry);
  const byId = new Map(stations.map((station) => [station.id, station]));
  const find = (id: string): StationDetail | undefined => {
    const station = byId.get(id);
    const timezone = snapshot.timezones[id] ?? null;
    return (
      station && {
        ...station,
        tags: [],
        timezone,
        timezoneSource: timezone ? 'geonames' : null,
        homepage: null,
        streams: [],
      }
    );
  };
  return {
    async loadCatalog(signal: AbortSignal, onProgress: (loaded: number, total: number) => void) {
      signal.throwIfAborted();
      onProgress(stations.length, stations.length);
      return { manifest: snapshot.manifest, stations, stale: false };
    },
    async lookup(ids: readonly string[], signal: AbortSignal) {
      signal.throwIfAborted();
      const items: StationDetail[] = [];
      const missing: string[] = [];
      for (const id of new Set(ids)) {
        const detail = find(id);
        if (detail) items.push(detail);
        else missing.push(id);
      }
      return { items, missing };
    },
    async station(id: string, signal: AbortSignal) {
      signal.throwIfAborted();
      const detail = find(id);
      if (!detail) throw new HttpError(404, 'NOT_FOUND');
      return detail;
    },
  };
}
