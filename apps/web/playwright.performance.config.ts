import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig({
  testDir: './tests/performance',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 2,
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
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'firefox',
      testMatch: 'resources.spec.ts',
      use: { ...devices['Desktop Firefox'], ...(process.env.CI ? { headless: false } : {}) },
    },
    {
      name: 'webkit',
      testMatch: 'resources.spec.ts',
      use: { ...devices['Desktop Safari'] },
    },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      cwd: repositoryRoot,
      command: 'pnpm --filter @haen/web preview',
      url: 'http://127.0.0.1:4173',
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
