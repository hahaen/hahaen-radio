import { randomUUID } from 'node:crypto';
import { and, desc, eq, gt, inArray, notInArray, or, sql } from 'drizzle-orm';
import {
  CatalogManifestSchema,
  SceneEntrySchema,
  decodeSceneEntry,
  type StationPreview,
  StationDetailSchema,
  type CatalogManifest,
  type StationDetail,
  type StationSearch,
} from '@haen/contracts';
import type { Database, DatabaseSession } from '../../db/connection.js';
import {
  catalogEntries,
  catalogHead,
  catalogVersions,
  jobLeases,
  jobRuns,
  stationOverrides,
  stationRegistry,
} from '../../db/schema.js';
import type { CatalogSnapshot, RegistryEntry } from './snapshot.js';
import { readPlaces } from '../places/repository.js';
import { createPlaceEnricher } from '../places/geonames.js';

const JOB = 'catalog-sync';
const leaseExpiry = sql`DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 2 MINUTE)`;
export interface CatalogQuery {
  version: string;
  offset: number;
  limit: number;
  ids?: string[];
  search?: StationSearch;
  sameCity?: { city: string; countryCode: string };
}
const jsonText = (field: 'name' | 'region' | 'city' | 'nearbyCity' | 'countryCode' | 'genre') =>
  sql<string>`COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(${catalogEntries.payload}, ${`$.${field}`})), 'null'), '')`;
const fold = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const names = [
  new Intl.DisplayNames(['en'], { type: 'region' }),
  new Intl.DisplayNames(['zh-CN'], { type: 'region' }),
];
const countryTerms = Array.from({ length: 676 }, (_, index) =>
  String.fromCharCode(65 + Math.floor(index / 26), 65 + (index % 26)),
).map((code) => ({ code, text: fold([code, ...names.map((name) => name.of(code))].join(' ')) }));
export class LeaseLostError extends Error {
  constructor() {
    super('CATALOG_LEASE_LOST');
  }
}
export interface CatalogRepository {
  enrich(stations: StationDetail[], signal?: AbortSignal): Promise<StationDetail[]>;
  acquire(): Promise<string | null>;
  renew(token: string): Promise<void>;
  cleanup(token: string): Promise<void>;
  registry(): Promise<RegistryEntry[]>;
  stage(
    token: string,
    snapshot: CatalogSnapshot,
    sourceCount: number,
    signal?: AbortSignal,
  ): Promise<void>;
  publish(token: string, snapshot: CatalogSnapshot): Promise<void>;
  finish(token: string, errorCode?: string): Promise<void>;
  currentVersion(): Promise<string | null>;
  manifest(): Promise<CatalogManifest | null>;
  hasVersion(version: string): Promise<boolean>;
  sceneChunk(version: string, index: number): Promise<StationPreview[]>;
  query(input: CatalogQuery): Promise<{ items: StationDetail[]; total: number }>;
  read(version: string): Promise<CatalogSnapshot | null>;
  overrides(): Promise<Set<string>>;
  setBlocked(id: string, blocked: boolean, reason: string): Promise<void>;
}
async function assertLease(session: DatabaseSession, token: string) {
  const [lease] = await session
    .select({ token: jobLeases.token })
    .from(jobLeases)
    .where(
      and(
        eq(jobLeases.name, JOB),
        eq(jobLeases.token, token),
        gt(jobLeases.expiresAt, sql`UTC_TIMESTAMP(3)`),
      ),
    )
    .for('update');
  if (!lease) throw new LeaseLostError();
}
export function createCatalogRepository(database: Database): CatalogRepository {
  return {
    async enrich(stations, signal) {
      try {
        const enrich = createPlaceEnricher(await readPlaces(database, signal));
        return stations.map(enrich);
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new Error('CATALOG_PLACES_UNAVAILABLE', { cause: error });
      }
    },
    acquire: () =>
      database.run((session) =>
        session.transaction(async (tx) => {
          const token = randomUUID();
          await tx
            .insert(jobLeases)
            .ignore()
            .values({ name: JOB, token, expiresAt: new Date(0) });
          const [existing] = await tx
            .select({ expired: sql<number>`${jobLeases.expiresAt} <= UTC_TIMESTAMP(3)` })
            .from(jobLeases)
            .where(eq(jobLeases.name, JOB))
            .for('update');
          if (!existing?.expired) return null;
          await tx
            .update(jobLeases)
            .set({ token, expiresAt: leaseExpiry })
            .where(eq(jobLeases.name, JOB));
          await tx
            .insert(jobRuns)
            .values({ id: token, name: JOB, status: 'running', startedAt: sql`UTC_TIMESTAMP(3)` });
          return token;
        }),
      ),
    renew: (token) =>
      database.run((session) =>
        session.transaction(async (tx) => {
          await assertLease(tx, token);
          await tx
            .update(jobLeases)
            .set({ expiresAt: leaseExpiry })
            .where(and(eq(jobLeases.name, JOB), eq(jobLeases.token, token)));
        }),
      ),
    async cleanup(token) {
      const versions = await database.run((session) =>
        session
          .select({
            id: catalogVersions.id,
            status: catalogVersions.status,
            stale: sql<number>`${catalogVersions.createdAt} < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 DAY)`,
          })
          .from(catalogVersions)
          .orderBy(desc(catalogVersions.publishedAt), desc(catalogVersions.createdAt))
          .limit(1000),
      );
      const retained = new Set(
        versions
          .filter((version) => version.status === 'published')
          .slice(0, 2)
          .map((version) => version.id),
      );
      const head = await this.currentVersion();
      if (head) retained.add(head);
      for (const version of versions) {
        if (retained.has(version.id) || (version.status !== 'published' && !version.stale))
          continue;
        await database.run((session) =>
          session.transaction(async (tx) => {
            await assertLease(tx, token);
            await tx.delete(catalogEntries).where(eq(catalogEntries.versionId, version.id));
            await tx.delete(catalogVersions).where(eq(catalogVersions.id, version.id));
          }),
        );
      }
      await database.run((session) =>
        session.transaction(async (tx) => {
          await assertLease(tx, token);
          await tx
            .delete(jobRuns)
            .where(sql`${jobRuns.startedAt} < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 7 DAY)`);
        }),
      );
    },
    async registry() {
      const records: RegistryEntry[] = [];
      let after: string | undefined;
      for (;;) {
        const rows = await database.run((session) =>
          session
            .select({
              id: stationRegistry.id,
              payload: stationRegistry.payload,
              missingCount: stationRegistry.missingCount,
            })
            .from(stationRegistry)
            .where(after ? gt(stationRegistry.id, after) : undefined)
            .orderBy(stationRegistry.id)
            .limit(2000),
        );
        records.push(
          ...rows.map((row) => ({
            payload: StationDetailSchema.parse(row.payload),
            missingCount: row.missingCount,
          })),
        );
        if (records.length > 200000) throw new Error('CATALOG_REGISTRY_LIMIT');
        if (rows.length < 2000) return records;
        after = rows.at(-1)!.id;
      }
    },
    async stage(token, snapshot, sourceCount, signal) {
      signal?.throwIfAborted();
      await database.run((session) =>
        session.transaction(async (tx) => {
          await assertLease(tx, token);
          await tx.insert(catalogVersions).values({
            id: snapshot.manifest.version,
            status: 'staging',
            manifest: snapshot.manifest,
            sourceCount,
            createdAt: new Date(snapshot.manifest.createdAt),
          });
        }),
      );
      for (let offset = 0; offset < snapshot.entries.length; offset += 200) {
        signal?.throwIfAborted();
        const batch = snapshot.entries.slice(offset, offset + 200);
        await database.run((session) =>
          session.transaction(async (tx) => {
            await assertLease(tx, token);
            await tx.insert(catalogEntries).values(
              batch.map(({ station, observed }) => ({
                versionId: snapshot.manifest.version,
                stationId: station.id,
                payload: station,
                observed,
              })),
            );
          }),
        );
      }
    },
    publish: (token, snapshot) =>
      database.run((session) =>
        session.transaction(async (tx) => {
          await assertLease(tx, token);
          const version = snapshot.manifest.version;
          const [staged] = await tx
            .select({ count: sql<number>`COUNT(*)` })
            .from(catalogEntries)
            .where(eq(catalogEntries.versionId, version));
          const [metadata] = await tx
            .select()
            .from(catalogVersions)
            .where(eq(catalogVersions.id, version))
            .for('update');
          if (
            !metadata ||
            metadata.status !== 'staging' ||
            Number(staged?.count) !== snapshot.manifest.stationCount
          )
            throw new Error('CATALOG_INCOMPLETE_STAGE');
          await tx.execute(sql`UPDATE station_registry r
        INNER JOIN catalog_entries e ON e.station_id = r.id AND e.version_id = ${version}
        SET r.payload = e.payload,
          r.last_seen_version = IF(e.observed, ${version}, r.last_seen_version),
          r.missing_count = IF(e.observed, 0, r.missing_count + 1),
          r.last_seen_at = IF(e.observed, UTC_TIMESTAMP(3), r.last_seen_at)`);
          await tx.execute(sql`INSERT INTO station_registry (id, payload, last_seen_version, missing_count, last_seen_at)
        SELECT e.station_id, e.payload, ${version}, 0, UTC_TIMESTAMP(3)
        FROM catalog_entries e LEFT JOIN station_registry r ON r.id = e.station_id
        WHERE e.version_id = ${version} AND r.id IS NULL AND e.observed = 1`);
          await tx
            .update(catalogVersions)
            .set({ status: 'published', publishedAt: sql`UTC_TIMESTAMP(3)` })
            .where(eq(catalogVersions.id, version));
          await tx
            .insert(catalogHead)
            .values({ id: 1, versionId: version })
            .onDuplicateKeyUpdate({ set: { versionId: version } });
          await tx
            .update(jobRuns)
            .set({
              status: 'succeeded',
              processedCount: snapshot.manifest.stationCount,
              finishedAt: sql`UTC_TIMESTAMP(3)`,
            })
            .where(eq(jobRuns.id, token));
        }),
      ),
    finish: (token, errorCode) =>
      database.run((session) =>
        session.transaction(async (tx) => {
          if (errorCode)
            await tx
              .update(jobRuns)
              .set({
                status: 'failed',
                errorCode: errorCode.slice(0, 64),
                finishedAt: sql`UTC_TIMESTAMP(3)`,
              })
              .where(and(eq(jobRuns.id, token), eq(jobRuns.status, 'running')));
          await tx
            .update(jobLeases)
            .set({ expiresAt: sql`UTC_TIMESTAMP(3)` })
            .where(and(eq(jobLeases.name, JOB), eq(jobLeases.token, token)));
        }),
      ),
    currentVersion: () =>
      database.run(async (session) => {
        const [head] = await session.select().from(catalogHead).where(eq(catalogHead.id, 1));
        return head?.versionId ?? null;
      }),
    manifest: () =>
      database.run(async (session) => {
        const [metadata] = await session
          .select({ manifest: catalogVersions.manifest })
          .from(catalogHead)
          .innerJoin(catalogVersions, eq(catalogHead.versionId, catalogVersions.id))
          .where(and(eq(catalogHead.id, 1), eq(catalogVersions.status, 'published')));
        if (!metadata) return null;
        const manifest = CatalogManifestSchema.parse(metadata.manifest);
        const [blocked] = await session
          .select({ count: sql<number>`COUNT(*)` })
          .from(catalogEntries)
          .innerJoin(stationOverrides, eq(catalogEntries.stationId, stationOverrides.stationId))
          .where(
            and(
              eq(catalogEntries.versionId, manifest.version),
              eq(stationOverrides.blocked, true),
              sql`JSON_UNQUOTE(JSON_EXTRACT(${catalogEntries.payload}, '$.availability')) = 'available'`,
              sql`JSON_LENGTH(JSON_EXTRACT(${catalogEntries.payload}, '$.streams')) > 0`,
            ),
          );
        return {
          ...manifest,
          playableCount: Math.max(0, manifest.playableCount - Number(blocked?.count ?? 0)),
        };
      }),
    hasVersion: (version) =>
      database.run(
        async (session) =>
          (
            await session
              .select({ id: catalogVersions.id })
              .from(catalogVersions)
              .where(and(eq(catalogVersions.id, version), eq(catalogVersions.status, 'published')))
              .limit(1)
          ).length === 1,
      ),
    sceneChunk: (version, index) =>
      database.run(async (session) => {
        const fields = [
          'id',
          'name',
          'countryCode',
          'region',
          'city',
          'nearbyCity',
          'latitude',
          'longitude',
          'locationPrecision',
          'genre',
          'languages',
          'bitrate',
          'availability',
        ];
        const values = fields.map(
          (field) => sql`JSON_EXTRACT(${catalogEntries.payload}, ${`$.${field}`})`,
        );
        const rows = await session
          .select({ entry: sql<unknown>`JSON_ARRAY(${sql.join(values, sql`, `)})` })
          .from(catalogEntries)
          .innerJoin(catalogVersions, eq(catalogEntries.versionId, catalogVersions.id))
          .where(
            and(eq(catalogEntries.versionId, version), eq(catalogVersions.status, 'published')),
          )
          .orderBy(catalogEntries.stationId)
          .offset(index * 1000)
          .limit(1000);
        return rows.map((row) => decodeSceneEntry(SceneEntrySchema.parse(row.entry)));
      }),
    query: (input) =>
      database.run(async (session) => {
        const filters = [eq(catalogEntries.versionId, input.version)];
        if (input.ids) filters.push(inArray(catalogEntries.stationId, input.ids));
        if (input.sameCity)
          filters.push(
            eq(jsonText('city'), input.sameCity.city),
            eq(jsonText('countryCode'), input.sameCity.countryCode),
          );
        if (input.search) {
          const query = input.search;
          if (query.excludeIds.length)
            filters.push(notInArray(catalogEntries.stationId, query.excludeIds));
          if (query.playableOnly)
            filters.push(
              sql`JSON_UNQUOTE(JSON_EXTRACT(${catalogEntries.payload}, '$.availability')) = 'available'`,
              sql`JSON_LENGTH(JSON_EXTRACT(${catalogEntries.payload}, '$.streams')) > 0`,
              sql`NOT EXISTS (SELECT 1 FROM station_overrides o WHERE o.station_id = ${catalogEntries.stationId} AND o.blocked = 1)`,
            );
          if (query.genres) filters.push(inArray(jsonText('genre'), query.genres));
          if (query.languages)
            filters.push(
              sql`JSON_OVERLAPS(JSON_EXTRACT(${catalogEntries.payload}, '$.languages'), CAST(${JSON.stringify(query.languages)} AS JSON))`,
            );
          if (query.minBitrate > 0)
            filters.push(
              sql`CAST(JSON_UNQUOTE(JSON_EXTRACT(${catalogEntries.payload}, '$.bitrate')) AS UNSIGNED) >= ${query.minBitrate}`,
            );
          for (const term of fold(query.q.trim()).split(/\s+/).filter(Boolean)) {
            const pattern = `%${term.replace(/[!%_]/g, (value) => `!${value}`)}%`;
            const codes = countryTerms
              .filter((country) => country.text.includes(term))
              .map((country) => country.code);
            filters.push(
              or(
                sql`CONCAT_WS(' ', ${jsonText('name')}, ${jsonText('region')}, ${jsonText('city')}, ${jsonText('nearbyCity')}, ${jsonText('countryCode')}) COLLATE utf8mb4_general_ci LIKE ${pattern} ESCAPE '!'`,
                inArray(jsonText('countryCode'), codes),
              )!,
            );
          }
        }
        const condition = and(...filters);
        const [count] = await session
          .select({ total: sql<number>`COUNT(*)` })
          .from(catalogEntries)
          .where(condition);
        const rows = await session
          .select({ payload: catalogEntries.payload })
          .from(catalogEntries)
          .where(condition)
          .orderBy(catalogEntries.stationId)
          .offset(input.offset)
          .limit(input.limit);
        return {
          total: Number(count?.total ?? 0),
          items: rows.map((row) => StationDetailSchema.parse(row.payload)),
        };
      }),
    async read(version) {
      const metadata = await database.run(async (session) => {
        const [metadata] = await session
          .select()
          .from(catalogVersions)
          .where(and(eq(catalogVersions.id, version), eq(catalogVersions.status, 'published')));
        return metadata;
      });
      if (!metadata) return null;
      const manifest = CatalogManifestSchema.parse(metadata.manifest);
      if (manifest.stationCount > 200000) throw new Error('CATALOG_REGISTRY_LIMIT');
      const entries: CatalogSnapshot['entries'] = [];
      let after: string | undefined;
      for (;;) {
        const rows = await database.run((session) =>
          session
            .select({
              id: catalogEntries.stationId,
              payload: catalogEntries.payload,
              observed: catalogEntries.observed,
            })
            .from(catalogEntries)
            .where(
              and(
                eq(catalogEntries.versionId, version),
                after ? gt(catalogEntries.stationId, after) : undefined,
              ),
            )
            .orderBy(catalogEntries.stationId)
            .limit(2000),
        );
        entries.push(
          ...rows.map((row) => ({
            station: StationDetailSchema.parse(row.payload),
            observed: row.observed,
          })),
        );
        if (entries.length > manifest.stationCount) throw new Error('CATALOG_CORRUPTED');
        if (rows.length < 2000) break;
        after = rows.at(-1)!.id;
      }
      if (entries.length !== manifest.stationCount) throw new Error('CATALOG_CORRUPTED');
      return { manifest, entries };
    },
    overrides: () =>
      database.run(
        async (session) =>
          new Set(
            (
              await session
                .select({ id: stationOverrides.stationId })
                .from(stationOverrides)
                .where(eq(stationOverrides.blocked, true))
            ).map((row) => row.id),
          ),
      ),
    setBlocked: (id, blocked, reason) =>
      database.run(async (session) => {
        const values = { stationId: id, blocked, reason, updatedAt: new Date() };
        await session.insert(stationOverrides).values(values).onDuplicateKeyUpdate({ set: values });
      }),
  };
}
