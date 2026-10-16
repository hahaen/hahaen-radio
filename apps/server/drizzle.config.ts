import { defineConfig } from 'drizzle-kit';
import { readDatabaseConfig } from './src/config/database.js';
import { migrationConnectionUrl } from './src/config/migration.js';

const migrating = process.argv.includes('migrate');
const connection = migrating ? readDatabaseConfig() : undefined;
export default defineConfig({
  dialect: 'mysql',
  schema: './src/db/schema.ts',
  out: '../../migrations',
  ...(connection
    ? {
        dbCredentials: { url: migrationConnectionUrl(connection) },
      }
    : {}),
  strict: true,
  verbose: false,
});
