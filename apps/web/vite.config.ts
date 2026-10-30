import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { randomBytes } from 'node:crypto';

const base = process.env.HAEN_WEB_BASE_PATH || '/';
if (!/^\/(?:[a-z0-9-]+\/)*$/.test(base)) throw new Error('Invalid HAEN_WEB_BASE_PATH');
const version = randomBytes(16).toString('hex');
export default defineConfig({
  base,
  define: { 'import.meta.env.HAEN_WEB_BUILD_ID': JSON.stringify(version) },
  plugins: [
    react(),
    {
      name: 'web-version',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ version }),
        });
      },
    },
  ],
  server: {
    proxy: {
      [base + 'api']: {
        target: 'http://127.0.0.1:3001',
        rewrite: (path) => '/' + path.slice(base.length),
      },
    },
  },
  build: {
    target: ['chrome120', 'firefox121', 'safari17'],
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'version-update', test: /\/platform\/(VersionUpdate|version)\.[jt]sx?$/ },
          ],
        },
      },
    },
  },
});
