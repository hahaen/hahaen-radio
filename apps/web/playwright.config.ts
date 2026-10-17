import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  ...(process.env.CI ? { workers: 2 } : {}),
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    [
      'html',
      {
        open: 'never',
        outputFolder: fileURLToPath(new URL('./playwright-report/', import.meta.url)),
      },
    ],
  ],
  outputDir: fileURLToPath(new URL('./test-results/', import.meta.url)),
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], ...(process.env.CI ? { headless: false } : {}) },
    },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      cwd: repositoryRoot,
      command: 'pnpm --filter @haen/server exec node --import tsx src/entrypoints/api.ts',
      env: { RECOGNITION_ENABLED: 'false' },
      url: 'http://127.0.0.1:3001/api/v1/health/live',
      timeout: 30000,
      reuseExistingServer: false,
    },
    {
      cwd: repositoryRoot,
      command: 'pnpm --filter @haen/web dev',
      url: 'http://127.0.0.1:5173',
      timeout: 30000,
      reuseExistingServer: false,
    },
  ],
});
