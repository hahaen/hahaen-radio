import { readDatabaseConfig } from '/work/apps/server/dist/config/database.js';
import { openDatabase } from '/work/apps/server/dist/db/connection.js';
import { createCatalogRepository } from '/work/apps/server/dist/modules/catalog/repository.js';
import { synchronizeCatalog } from '/work/apps/server/dist/modules/catalog/sync.js';
import { normalizeStation } from '/work/apps/server/dist/modules/catalog/normalize.js';

let database;
try {
  if (
    process.env.NODE_ENV !== 'test' ||
    !/^ha_radio_test_ci_[a-f0-9]{12}$/.test(process.env.DB_NAME ?? '')
  )
    throw Error('Dedicated image test required');
  database = await openDatabase(readDatabaseConfig());
  const station = normalizeStation({
    stationuuid: '00000000-0000-4000-8000-000000000001',
    name: '镜像验收 🌊',
    url: 'https://radio.example/live',
    lastcheckok: 1,
  });
  await synchronizeCatalog(createCatalogRepository(database), {
    load: async () => ({ stations: [station], sourceCount: 1, invalidCount: 0 }),
  });
  console.info(JSON.stringify({ event: 'image_fixture_ready' }));
} catch {
  console.error(JSON.stringify({ event: 'image_fixture_failed' }));
  process.exitCode = 1;
} finally {
  await database?.close();
}
