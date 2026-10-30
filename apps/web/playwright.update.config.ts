import { defineConfig } from '@playwright/test';
import config from './playwright.config.js';

export default defineConfig({
  ...config,
  testDir: './tests/update',
  workers: 2,
  use: { ...config.use, baseURL: 'http://127.0.0.1:4175' },
  webServer: {
    env: { HAEN_WEB_BASE_PATH: '/radio/' },
    command: 'pnpm exec vite preview --host 127.0.0.1 --port 4175 --strictPort',
    url: 'http://127.0.0.1:4175/radio/',
    reuseExistingServer: false,
  },
});
