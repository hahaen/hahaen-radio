import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const base = process.env.HAEN_WEB_BASE_PATH || '/';
if (!/^\/(?:[a-z0-9-]+\/)*$/.test(base)) throw new Error('Invalid HAEN_WEB_BASE_PATH');
export default defineConfig({
  base,
  plugins: [react()],
  server: {
    proxy: {
      [base + 'api']: {
        target: 'http://127.0.0.1:3001',
        rewrite: (path) => '/' + path.slice(base.length),
      },
    },
  },
  build: { target: ['chrome120', 'firefox121', 'safari17'] },
});
