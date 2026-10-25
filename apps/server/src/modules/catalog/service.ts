import { createHash } from 'node:crypto';
import { encodeSceneEntry, GenreSchema, StationSearchSchema } from '@haen/contracts';
import type { CatalogManifest, StationDetail, StationSearch } from '@haen/contracts';
import type { CatalogRepository } from './repository.js';
import { CATALOG_CHUNK_SIZE, summaryOf } from './snapshot.js';

export class CatalogUnavailableError extends Error {
  constructor() {
    super('CATALOG_NOT_READY');
  }
}
export class CatalogNotFoundError extends Error {
  constructor() {
    super('CATALOG_NOT_FOUND');
  }
}
export function createCatalogService(repository: CatalogRepository) {
  let blocked = new Set<string>();
  let blockedUntil = 0;
  let pending: Promise<void> | undefined;
  async function refreshOverrides() {
    if (Date.now() < blockedUntil) return;
    pending ??= repository
      .overrides()
      .then((value) => {
        blocked = value;
        blockedUntil = Date.now() + 5000;
      })
      .finally(() => {
        pending = undefined;
      });
    await pending;
  }
  const revision = (rules: ReadonlySet<string> = blocked) =>
    createHash('sha256')
      .update([...rules].sort().join('\n'))
      .digest('hex');
  async function currentVersion() {
    const version = await repository.currentVersion();
    if (!version) throw new CatalogUnavailableError();
    await refreshOverrides();
    return version;
  }
  const apply = (station: StationDetail, rules: ReadonlySet<string> = blocked): StationDetail =>
    rules.has(station.id)
      ? { ...station, availability: 'blocked', streams: [], homepage: null }
      : station;
  async function stationById(id: string) {
    const version = await currentVersion();
    const { items } = await repository.query({
      version,
      ids: [id.toLowerCase()],
      offset: 0,
      limit: 1,
    });
    if (!items[0]) throw new CatalogNotFoundError();
    return apply(items[0]);
  }
  async function readChunk(version: string, index: number) {
    version = version.toLowerCase();
    if (!(await repository.hasVersion(version))) throw new CatalogNotFoundError();
    await refreshOverrides();
    const rules = new Set(blocked);
    const data = await repository.query({
      version,
      offset: index * CATALOG_CHUNK_SIZE,
      limit: CATALOG_CHUNK_SIZE,
    });
    if (!data.items.length) throw new CatalogNotFoundError();
    return {
      version,
      index,
      restrictionsRevision: revision(rules),
      items: data.items.map((station) => summaryOf(apply(station, rules))),
    };
  }
  return {
    async readiness() {
      try {
        const manifest = await repository.manifest();
        return {
          status: manifest ? ('ready' as const) : ('not_ready' as const),
          database: true,
          catalog: manifest !== null,
          version: manifest?.version ?? null,
        };
      } catch {
        return { status: 'not_ready' as const, database: false, catalog: false, version: null };
      }
    },
    async manifest(): Promise<CatalogManifest> {
      const manifest = await repository.manifest();
      if (!manifest) throw new CatalogUnavailableError();
      return manifest;
    },
    async sceneManifest() {
      const manifest = await this.manifest();
      await refreshOverrides();
      return { ...manifest, format: 1 as const, restrictionsRevision: revision() };
    },
    async sceneChunk(version: string, index: number) {
      version = version.toLowerCase();
      await refreshOverrides();
      const rules = new Set(blocked);
      const items = await repository.sceneChunk(version, index);
      if (!items.length) throw new CatalogNotFoundError();
      return {
        format: 1 as const,
        version,
        index,
        restrictionsRevision: revision(rules),
        entries: items.map((station) =>
          encodeSceneEntry(
            rules.has(station.id) ? { ...station, availability: 'blocked' } : station,
          ),
        ),
      };
    },
    async chunk(version: string, index: number) {
      const chunk = await readChunk(version, index);
      return { version: chunk.version, index: chunk.index, items: chunk.items };
    },
    async search(query: StationSearch) {
      const version = await currentVersion();
      const data = await repository.query({
        version,
        offset: query.offset,
        limit: query.limit,
        search: query,
      });
      return {
        items: data.items.map((station) => summaryOf(apply(station))),
        total: data.total,
        offset: query.offset,
        limit: query.limit,
      };
    },
    async randomChina(excludeIds: string[]) {
      const version = await currentVersion();
      const search = StationSearchSchema.parse({
        genres: GenreSchema.options.filter((genre) => genre !== 'religious').join(','),
        playableOnly: 'true',
        excludeIds: excludeIds.join(','),
      });
      const query = { version, countryCode: 'CN', search, offset: 0, limit: 1 };
      const first = await repository.query(query);
      if (!first.total) return { station: null };
      const offset = Math.floor(Math.random() * first.total);
      const selected = offset === 0 ? first : await repository.query({ ...query, offset });
      const station = selected.items[0] ? apply(selected.items[0]) : null;
      return {
        station: station?.availability === 'available' && station.streams.length ? station : null,
      };
    },
    station: stationById,
    async lookup(ids: string[]) {
      const version = await currentVersion();
      const unique = [...new Set(ids.map((id) => id.toLowerCase()))];
      const data = await repository.query({ version, offset: 0, limit: 100, ids: unique });
      const byId = new Map(data.items.map((station) => [station.id, apply(station)]));
      return {
        items: unique.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
        missing: unique.filter((id) => !byId.has(id)),
      };
    },
    async streams(id: string) {
      const station = await stationById(id);
      return {
        stationId: station.id,
        streams: station.availability === 'available' ? station.streams : [],
      };
    },
    async sameCity(id: string) {
      const version = await currentVersion();
      const data = await repository.query({
        version,
        ids: [id.toLowerCase()],
        offset: 0,
        limit: 1,
      });
      const station = data.items[0];
      if (!station) throw new CatalogNotFoundError();
      const same =
        station.city && station.countryCode
          ? await repository.query({
              version,
              offset: 0,
              limit: 100,
              sameCity: { city: station.city, countryCode: station.countryCode },
            })
          : { items: [], total: 0 };
      return {
        items: same.items.map((item) => summaryOf(apply(item))),
        total: same.total,
        offset: 0,
        limit: 100,
      };
    },
  };
}
export type CatalogService = ReturnType<typeof createCatalogService>;
