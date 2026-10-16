import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @haen/server dev',
      env: { RECOGNITION_ENABLED: 'false' },
      url: 'http://127.0.0.1:3001/api/v1/health/live',
      timeout: 30000,
      reuseExistingServer: false,
    },
    {
      command: 'pnpm --filter @haen/web dev',
      url: 'http://127.0.0.1:5173',
      timeout: 30000,
      reuseExistingServer: false,
    },
  ],
});
