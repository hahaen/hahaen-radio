import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { encodeSceneEntry, StationSearchSchema } from '@haen/contracts';
import { readDatabaseConfig } from '../config/database.js';
import { createCatalogRepository } from '../modules/catalog/repository.js';
import { createCatalogService } from '../modules/catalog/service.js';
import { normalizeStation } from '../modules/catalog/normalize.js';
import { prepareSnapshot } from '../modules/catalog/snapshot.js';
import { synchronizeCatalog } from '../modules/catalog/sync.js';
import { openDatabase, type Database } from './connection.js';
import { catalogVersions, jobLeases, stationOverrides, places, jobRuns } from './schema.js';
import { readPlaces, replacePlaces } from '../modules/places/repository.js';

describe.skipIf(process.env.HAEN_MYSQL_TESTS !== '1')('MySQL 8.0.46 isolated acceptance', () => {
  let database: Database;
  beforeAll(async () => {
    if (process.env.NODE_ENV !== 'test') throw new Error('Isolated test environment required');
    database = await openDatabase(readDatabaseConfig());
  });
  afterAll(async () => {
    await database?.close();
  });
  it('verifies every table option, ASCII identifiers, retained Unicode data and two migration records', async () => {
    await database.run(async (session) => {
      const [tables] = await session.execute(
        sql`SELECT TABLE_NAME, ENGINE, TABLE_COLLATION, ROW_FORMAT FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`,
      );
      const rows = tables as unknown as {
        TABLE_NAME: string;
        ENGINE: string;
        TABLE_COLLATION: string;
        ROW_FORMAT: string;
      }[];
      expect(rows).toHaveLength(9);
      for (const row of rows)
        expect(row).toMatchObject({
          ENGINE: 'InnoDB',
          TABLE_COLLATION: 'utf8mb4_general_ci',
          ROW_FORMAT: 'Dynamic',
        });
      const [columns] = await session.execute(
        sql`SELECT COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'catalog_entries' AND COLUMN_NAME IN ('version_id', 'station_id')`,
      );
      expect(columns).toEqual([{ COLLATION_NAME: 'ascii_bin' }, { COLLATION_NAME: 'ascii_bin' }]);
      expect((await session.select().from(stationOverrides))[0]?.reason).toBe('迁移保留验证 🌊');
      const [history] = await session.execute(
        sql`SELECT COUNT(*) AS count FROM __drizzle_migrations`,
      );
      expect(history).toEqual([{ count: 2 }]);
    });
  });
  it('publishes repeatable snapshots, retains a successful head after failure and prevents competing workers', async () => {
    const repository = createCatalogRepository(database);
    const stations = [
      normalizeStation({
        stationuuid: '00000000-0000-4000-8000-000000000001',
        name: 'Café 数据库测试 🌊',
        countrycode: 'FR',
        tags: 'jazz',
        languagecodes: 'fr',
        bitrate: 192,
        url: 'https://radio.example/live',
        lastcheckok: 1,
      })!,
    ];
    const source = { load: async () => ({ stations, sourceCount: 1, invalidCount: 0 }) };
    const first = await synchronizeCatalog(repository, source);
    expect(first.status).toBe('published');
    const old = await repository.currentVersion();
    const second = await synchronizeCatalog(repository, source);
    expect(second.status).toBe('published');
    expect(await repository.registry()).toHaveLength(1);
    const current = await repository.currentVersion();
    expect(current).not.toBe(old);
    const service = createCatalogService(repository);
    expect(await service.readiness()).toMatchObject({ status: 'ready', catalog: true });
    expect(
      (
        await service.search(
          StationSearchSchema.parse({
            q: 'cafe',
            languages: 'fr',
            genres: 'jazz',
            minBitrate: 192,
          }),
        )
      ).total,
    ).toBe(1);
    expect((await service.search(StationSearchSchema.parse({ q: '法国' }))).total).toBe(1);
    expect((await service.search(StationSearchSchema.parse({ genres: '' }))).total).toBe(0);
    expect(
      (await service.search(StationSearchSchema.parse({ excludeIds: stations[0]!.id }))).total,
    ).toBe(0);
    expect((await service.chunk(current!, 0)).items[0]?.name).toBe('Café 数据库测试 🌊');
    expect((await service.sceneChunk(current!, 0)).entries).toEqual(stations.map(encodeSceneEntry));
    await expect(repository.sceneChunk('00000000-0000-4000-8000-000000000099', 0)).resolves.toEqual(
      [],
    );
    await expect(repository.sceneChunk(current!, 1)).resolves.toEqual([]);
    await expect(
      synchronizeCatalog(repository, {
        load: async () => {
          throw new Error('controlled failure');
        },
      }),
    ).rejects.toThrow('CATALOG_SYNC_FAILED');
    expect(await repository.currentVersion()).toBe(current);
    const token = await repository.acquire();
    expect(token).not.toBeNull();
    expect(await repository.acquire()).toBeNull();
    const unfinished = prepareSnapshot(stations, []);
    await repository.stage(token!, unfinished, 1);
    expect(await repository.sceneChunk(unfinished.manifest.version, 0)).toEqual([]);
    expect(await repository.currentVersion()).toBe(current);
    await database.run(async (session) => {
      await session
        .update(jobLeases)
        .set({ expiresAt: new Date(0) })
        .where(eq(jobLeases.token, token!));
    });
    const replacement = await repository.acquire();
    await expect(repository.publish(token!, unfinished)).rejects.toThrow('CATALOG_LEASE_LOST');
    expect(await repository.currentVersion()).toBe(current);
    await repository.finish(token!, 'CATALOG_LEASE_LOST');
    await repository.renew(replacement!);
    await repository.finish(replacement!, 'TEST_FINISHED');
    await repository.setBlocked(stations[0]!.id, true, '人工屏蔽验证');
    expect(
      (
        await createCatalogService(repository).search(
          StationSearchSchema.parse({ playableOnly: 'true' }),
        )
      ).total,
    ).toBe(0);
    expect(await createCatalogService(repository).station(stations[0]!.id)).toMatchObject({
      availability: 'blocked',
      streams: [],
    });
  });
  it('atomically replaces offline places and rolls back a cancelled import after its first batch', async () => {
    const original = Array.from({ length: 1001 }, (_, index) => ({
      id: index + 1,
      name: '京都市',
      asciiName: 'Kyoto',
      aliases: '京都,Kyoto',
      countryCode: 'JP',
      latitude: 35.011,
      longitude: 135.768,
      timezone: 'Asia/Tokyo',
    }));
    await expect(replacePlaces(database, original)).resolves.toMatchObject({ count: 1001 });
    const controller = new AbortController();
    const check = controller.signal.throwIfAborted.bind(controller.signal);
    let checkpoints = 0;
    const spy = vi.spyOn(controller.signal, 'throwIfAborted').mockImplementation(() => {
      if (++checkpoints === 3) controller.abort();
      check();
    });
    try {
      await expect(
        replacePlaces(
          database,
          Array.from({ length: 2001 }, (_, index) => ({
            ...original[0]!,
            id: index + 10001,
            name: 'cancelled replacement',
          })),
          controller.signal,
        ),
      ).rejects.toThrow();
      expect(checkpoints).toBe(3);
    } finally {
      spy.mockRestore();
    }
    const retained = await readPlaces(database);
    expect(retained).toHaveLength(1001);
    expect(retained.every((row) => row.name === '京都市')).toBe(true);
    expect(
      await database.run((session) =>
        session.select().from(jobRuns).where(eq(jobRuns.name, 'places-import')),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'succeeded', processedCount: 1001 }),
        expect.objectContaining({ status: 'failed', errorCode: 'PLACES_IMPORT_FAILED' }),
      ]),
    );
    let reads = 0;
    await expect(
      readPlaces({
        close: () => database.close(),
        async run(operation) {
          if (++reads === 3)
            await replacePlaces(
              database,
              original.map((row) => ({ ...row, id: row.id + 50000 })),
            );
          return database.run(operation);
        },
      }),
    ).rejects.toThrow('PLACES_SNAPSHOT_CHANGED');
    await replacePlaces(database, original);
    const enriched = await createCatalogRepository(database).enrich([
      normalizeStation({
        stationuuid: '00000000-0000-4000-8000-000000000050',
        name: 'Place fixture',
        countrycode: 'JP',
        geo_lat: 35.011,
        geo_long: 135.768,
      })!,
    ]);
    expect(enriched[0]).toMatchObject({ city: null, nearbyCity: '京都市', timezone: 'Asia/Tokyo' });
    await database.run(async (session) => {
      await session.delete(places);
    });
  });
  it('rolls back business writes on an application transaction failure', async () => {
    await expect(
      database.run((session) =>
        session.transaction(async (tx) => {
          await tx.update(catalogVersions).set({ status: 'broken' });
          throw new Error('controlled rollback');
        }),
      ),
    ).rejects.toThrow('controlled rollback');
    const states = await database.run((session) => session.select().from(catalogVersions));
    expect(states.some((state) => state.status === 'broken')).toBe(false);
  });
  it('destroys a timed-out operation connection and remains usable', async () => {
    await expect(
      database.run(async (session) => {
        await session.execute('SELECT SLEEP(18)');
      }),
    ).rejects.toThrow('Database operation timed out');
    await expect(
      database.run(async (session) => {
        await session.execute('SELECT 1');
        return true;
      }),
    ).resolves.toBe(true);
  }, 22000);
  it('releases a connection acquired after its queue deadline', async () => {
    const limited = await openDatabase({ ...readDatabaseConfig(), connectionLimit: 1 });
    try {
      let started: (() => void) | undefined;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      const occupying = limited.run(async (session) => {
        started!();
        await session.execute('SELECT SLEEP(9)');
      });
      await ready;
      await expect(
        limited.run(async (session) => {
          await session.execute('SELECT 1');
        }),
      ).rejects.toThrow('Database operation timed out');
      await occupying;
      await expect(
        limited.run(async (session) => {
          await session.execute('SELECT 1');
          return true;
        }),
      ).resolves.toBe(true);
    } finally {
      await limited.close();
    }
  }, 18000);
});
