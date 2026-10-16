import mysql from 'mysql2/promise';
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import { z } from 'zod';
import type { DatabaseConfig } from '../config/database.js';
import * as schema from './schema.js';
export type DatabaseSession = MySql2Database<typeof schema>;
export class DatabaseTimeoutError extends Error {
  constructor() {
    super('Database operation timed out');
  }
}
export interface Database {
  run<T>(operation: (session: DatabaseSession) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export async function openDatabase(config: DatabaseConfig): Promise<Database> {
  const { ssl, ...credentials } = config;
  const pool = mysql.createPool({
    ...credentials,
    charset: 'utf8mb4_general_ci',
    timezone: 'Z',
    connectTimeout: 8000,
    waitForConnections: true,
    queueLimit: 20,
    enableKeepAlive: true,
    maxIdle: config.connectionLimit,
    idleTimeout: 30000,
    ...(ssl ? { ssl } : {}),
  });
  const database: Database = {
    async run<T>(operation: (session: DatabaseSession) => Promise<T>) {
      let acquiring = true;
      let acquisitionTimer: ReturnType<typeof setTimeout> | undefined;
      const pending = pool.getConnection().then((connection) => {
        if (!acquiring) {
          connection.release();
          throw new DatabaseTimeoutError();
        }
        return connection;
      });
      const connection = await Promise.race([
        pending,
        new Promise<never>((_resolve, reject) => {
          acquisitionTimer = setTimeout(() => {
            acquiring = false;
            reject(new DatabaseTimeoutError());
          }, 8000);
        }),
      ]).finally(() => {
        if (acquisitionTimer) clearTimeout(acquisitionTimer);
      });
      let expired = false;
      let operationTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          (async () => {
            await connection.query("SET time_zone = '+00:00'");
            return operation(drizzle(connection, { schema, mode: 'default' }));
          })(),
          new Promise<never>((_resolve, reject) => {
            operationTimer = setTimeout(() => {
              expired = true;
              connection.destroy();
              reject(new DatabaseTimeoutError());
            }, 15000);
          }),
        ]);
      } finally {
        if (operationTimer) clearTimeout(operationTimer);
        if (!expired) connection.release();
      }
    },
    close: () => pool.end(),
  };
  try {
    await database.run(async (session) => {
      const [result] = await session.execute(
        'SELECT VERSION() AS version, @@character_set_connection AS charset, @@collation_connection AS collation, @@session.time_zone AS zone',
      );
      const row = z
        .array(
          z.object({
            version: z.string(),
            charset: z.string(),
            collation: z.string(),
            zone: z.string(),
          }),
        )
        .parse(result)[0];
      if (
        !row ||
        row.version.split('-')[0] !== '8.0.46' ||
        row.charset !== 'utf8mb4' ||
        row.collation !== 'utf8mb4_general_ci' ||
        row.zone !== '+00:00'
      )
        throw new Error('Database session does not match the configured baseline');
    });
    return database;
  } catch (error) {
    await pool.end();
    throw error;
  }
}
