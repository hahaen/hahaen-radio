import { readDatabaseConfig } from '../config/database.js';
import { openDatabase, type Database } from '../db/connection.js';
import { createDiagnosticRepository } from '../modules/diagnostics/repository.js';

let database: Database | undefined;
try {
  const [command, ...extra] = process.argv.slice(2);
  if (!['summary', 'cleanup'].includes(command ?? '') || extra.length)
    throw new Error('Invalid command');
  database = await openDatabase(readDatabaseConfig());
  const repository = createDiagnosticRepository(database);
  if (command === 'cleanup')
    console.info(
      JSON.stringify({ event: 'diagnostic_cleanup_finished', removed: await repository.cleanup() }),
    );
  else
    console.info(
      JSON.stringify({ event: 'diagnostic_summary', groups: await repository.summary() }),
    );
} catch {
  console.error(JSON.stringify({ event: 'diagnostic_command_failed' }));
  process.exitCode = 1;
} finally {
  await database?.close();
}
