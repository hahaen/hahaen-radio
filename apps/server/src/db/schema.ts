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
  check,
  uniqueIndex,
} from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import type { AccountCollection, CatalogManifest, StationDetail } from '@haen/contracts';
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

export const diagnosticLimits = mysqlTable(
  'diagnostic_limits',
  {
    id: int('id', { unsigned: true }).primaryKey(),
    periodDay: ascii('period_day', { length: 10 }).notNull(),
    acceptedCount: int('accepted_count', { unsigned: true }).notNull(),
    nextSlot: int('next_slot', { unsigned: true }).notNull(),
  },
  (table) => [
    check('diagnostic_limits_singleton', sql`${table.id} = 1`),
    check('diagnostic_limits_count', sql`${table.acceptedCount} <= 1000`),
    check('diagnostic_limits_slot', sql`${table.nextSlot} < 10000`),
  ],
);
export const playbackReports = mysqlTable(
  'playback_reports',
  {
    slot: int('slot', { unsigned: true }).primaryKey(),
    reportId: ascii('report_id', { length: 36 }).notNull(),
    stationId: ascii('station_id', { length: 36 }).notNull(),
    streamId: ascii('stream_id', { length: 24 }).notNull(),
    failure: ascii('failure', { length: 16 }).notNull(),
    createdAt: instant('created_at').notNull(),
    expiresAt: instant('expires_at').notNull(),
  },
  (table) => [
    uniqueIndex('playback_reports_receipt_idx').on(table.reportId),
    index('playback_reports_expiry_idx').on(table.expiresAt),
    check('playback_reports_slot_bound', sql`${table.slot} < 10000`),
    check(
      'playback_reports_failure',
      sql`${table.failure} IN ('network', 'timeout', 'unsupported', 'unavailable', 'offline')`,
    ),
    check(
      'playback_reports_validity',
      sql`${table.expiresAt} > ${table.createdAt} AND ${table.expiresAt} <= DATE_ADD(${table.createdAt}, INTERVAL 7 DAY)`,
    ),
  ],
);

export const accountUsers = mysqlTable(
  'account_users',
  {
    id: ascii('id', { length: 36 }).primaryKey(),
    username: ascii('username', { length: 32 }).notNull(),
    passwordHash: ascii('password_hash', { length: 192 }).notNull(),
    createdAt: instant('created_at').notNull(),
  },
  (table) => [uniqueIndex('account_users_username_idx').on(table.username)],
);
export const accountSessions = mysqlTable(
  'account_sessions',
  {
    tokenHash: ascii('token_hash', { length: 64 }).primaryKey(),
    userId: ascii('user_id', { length: 36 })
      .notNull()
      .references(() => accountUsers.id, { onDelete: 'cascade' }),
    expiresAt: instant('expires_at').notNull(),
  },
  (table) => [
    index('account_sessions_expiry_idx').on(table.expiresAt),
    index('account_sessions_user_idx').on(table.userId),
  ],
);
export const accountLibraries = mysqlTable('account_libraries', {
  userId: ascii('user_id', { length: 36 })
    .primaryKey()
    .references(() => accountUsers.id, { onDelete: 'cascade' }),
  revision: int('revision', { unsigned: true }).notNull().default(0),
  collection: json('collection').$type<AccountCollection>().notNull(),
});
