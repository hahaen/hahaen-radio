import {
  customType,
  datetime,
  index,
  int,
  json,
  mysqlTable,
  primaryKey,
  text,
  varchar,
  boolean,
  double,
} from 'drizzle-orm/mysql-core';
import type { CatalogManifest, StationDetail } from '@haen/contracts';
const ascii = customType<{
  data: string;
  driverData: string;
  config: { length: number };
  configRequired: true;
}>({ dataType: (config) => `varchar(${config.length}) CHARACTER SET ascii COLLATE ascii_bin` });
const instant = (name: string) => datetime(name, { mode: 'date', fsp: 3 });

export const catalogVersions = mysqlTable('catalog_versions', {
  id: ascii('id', { length: 36 }).primaryKey(),
  status: ascii('status', { length: 16 }).notNull(),
  manifest: json('manifest').$type<CatalogManifest>().notNull(),
  sourceCount: int('source_count').notNull(),
  createdAt: instant('created_at').notNull(),
  publishedAt: instant('published_at'),
});
export const catalogHead = mysqlTable('catalog_head', {
  id: int('id').primaryKey(),
  versionId: ascii('version_id', { length: 36 })
    .notNull()
    .references(() => catalogVersions.id),
});
export const catalogEntries = mysqlTable(
  'catalog_entries',
  {
    versionId: ascii('version_id', { length: 36 })
      .notNull()
      .references(() => catalogVersions.id),
    stationId: ascii('station_id', { length: 36 }).notNull(),
    observed: boolean('observed').notNull(),
    payload: json('payload').$type<StationDetail>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.versionId, table.stationId] })],
);
export const stationRegistry = mysqlTable('station_registry', {
  id: ascii('id', { length: 36 }).primaryKey(),
  payload: json('payload').$type<StationDetail>().notNull(),
  lastSeenVersion: ascii('last_seen_version', { length: 36 }).notNull(),
  missingCount: int('missing_count').notNull().default(0),
  lastSeenAt: instant('last_seen_at').notNull(),
});
export const stationOverrides = mysqlTable('station_overrides', {
  stationId: ascii('station_id', { length: 36 }).primaryKey(),
  blocked: boolean('blocked').notNull(),
  reason: varchar('reason', { length: 255 }).notNull(),
  updatedAt: instant('updated_at').notNull(),
});
export const jobLeases = mysqlTable('job_leases', {
  name: ascii('name', { length: 64 }).primaryKey(),
  token: ascii('token', { length: 36 }).notNull(),
  expiresAt: instant('expires_at').notNull(),
});
export const jobRuns = mysqlTable(
  'job_runs',
  {
    id: ascii('id', { length: 36 }).primaryKey(),
    name: ascii('name', { length: 64 }).notNull(),
    status: ascii('status', { length: 16 }).notNull(),
    startedAt: instant('started_at').notNull(),
    finishedAt: instant('finished_at'),
    processedCount: int('processed_count').notNull().default(0),
    errorCode: ascii('error_code', { length: 64 }),
  },
  (table) => [index('job_runs_started_idx').on(table.startedAt)],
);
export const places = mysqlTable(
  'places',
  {
    id: int('id', { unsigned: true }).primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    asciiName: varchar('ascii_name', { length: 255 }).notNull(),
    aliases: text('aliases').notNull(),
    countryCode: ascii('country_code', { length: 2 }).notNull(),
    latitude: double('latitude').notNull(),
    longitude: double('longitude').notNull(),
    timezone: ascii('timezone', { length: 64 }).notNull(),
    importedAt: instant('imported_at').notNull(),
  },
  (table) => [index('places_country_idx').on(table.countryCode)],
);
