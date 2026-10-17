import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    ...(process.env.CI ? { maxWorkers: 1 } : {}),
    projects: [
      {
        test: {
          name: 'server',
          environment: 'node',
          include: [
            'apps/server/src/**/*.test.ts',
            'packages/contracts/src/**/*.test.ts',
            'deploy/tests/**/*.test.mjs',
          ],
        },
      },
      { test: { name: 'web', environment: 'jsdom', include: ['apps/web/src/**/*.test.{ts,tsx}'] } },
    ],
    coverage: {
      provider: 'v8',
      include: ['apps/*/src/**/*.{ts,tsx}', 'packages/contracts/src/**/*.ts'],
      exclude: ['**/*.test.*', '**/entrypoints/**', '**/main.tsx'],
    },
  },
});
