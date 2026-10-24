import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

process.umask(0o077);

export default defineConfig({
  testDir: './tests',
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile: fileURLToPath(
          new URL('../../../.local/archive/android/graphics-tests-report.json', import.meta.url),
        ),
      },
    ],
  ],
  outputDir: fileURLToPath(
    new URL('../../../.local/archive/android/graphics-tests/', import.meta.url),
  ),
  use: {
    baseURL: 'http://127.0.0.1:4187/assets/graphics/',
    browserName: 'chromium',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    cwd: fileURLToPath(new URL('../../web/', import.meta.url)),
    command:
      'pnpm exec vite --config ../android/graphics/vite.config.ts --host 127.0.0.1 --port 4187 --strictPort',
    url: 'http://127.0.0.1:4187/assets/graphics/',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
