import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { readDatabaseConfig } from '../config/database.js';
import { openDatabase, type Database } from '../db/connection.js';
import { MAX_PLACE_BYTES, parseGeoNames } from '../modules/places/geonames.js';
import { replacePlaces } from '../modules/places/repository.js';

let database: Database | undefined;
const controller = new AbortController();
const abort = () => controller.abort();
process.once('SIGINT', abort);
process.once('SIGTERM', abort);
try {
  const [command, path, extra] = process.argv.slice(2);
  if (command !== 'import' || !path || extra) throw new Error('INVALID_COMMAND');
  const file = await open(path, 'r');
  let buffer: Buffer;
  try {
    if (!(await file.stat()).isFile()) throw new Error('PLACES_FILE_REQUIRED');
    // Read one extra byte to bound growth between stat and read without loading an arbitrary file.
    buffer = Buffer.alloc(MAX_PLACE_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > MAX_PLACE_BYTES) throw new Error('PLACES_FILE_TOO_LARGE');
    buffer = buffer.subarray(0, offset);
  } finally {
    await file.close();
  }
  const rows = parseGeoNames(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
  controller.signal.throwIfAborted();
  database = await openDatabase(readDatabaseConfig());
  const result = await replacePlaces(database, rows, controller.signal);
  console.info(
    JSON.stringify({
      event: 'places_import_finished',
      ...result,
      sourceSha256: createHash('sha256').update(buffer).digest('hex'),
    }),
  );
} catch {
  console.error(
    JSON.stringify({
      event: 'places_import_failed',
      usage: 'places import <local-geonames-tsv-file>',
    }),
  );
  process.exitCode = 1;
} finally {
  process.removeListener('SIGINT', abort);
  process.removeListener('SIGTERM', abort);
  await database?.close();
}
