import { defineConfig } from 'drizzle-kit';
import base from './drizzle.config.js';
if (process.env.NODE_ENV !== 'test' || !process.env.DB_TEST_MIGRATIONS_PATH)
  throw new Error('Invalid migration test configuration');
export default defineConfig({ ...base, out: process.env.DB_TEST_MIGRATIONS_PATH });
