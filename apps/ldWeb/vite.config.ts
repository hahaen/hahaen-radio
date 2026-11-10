import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig(({ command }) => ({
  define: command === 'build' ? { 'process.env.NODE_ENV': JSON.stringify('production') } : {},
  publicDir: false,
  resolve: {
    alias: { '@discourse-mini-app/sdk': path('../../.local/ldweb/sdk/index.mjs') },
  },
  server: { host: '127.0.0.1', port: 5192, strictPort: true },
  plugins: [
    react(),
    {
      name: 'haen-mini-app-body',
      configureServer(server) {
        server.middlewares.use('/data/streams.json', (_request, response) => {
          response.setHeader('content-type', 'application/json');
          response.end('[]');
        });
        server.middlewares.use('/data/land.json', (_request, response) => {
          response.setHeader('content-type', 'application/json');
          response.end(readFileSync(path('../web/public/geography/land.json')));
        });
      },
      transformIndexHtml: (html) =>
        html.replace('<!--app-->', readFileSync(path('./src/template.html'), 'utf8')),
    },
  ],
  build: {
    outDir: 'dist/web',
    target: 'es2022',
    cssCodeSplit: false,
    lib: {
      entry: path('./src/main.tsx'),
      name: 'HaenMiniApp',
      formats: ['iife'],
      fileName: () => 'app.js',
      cssFileName: 'app',
    },
  },
}));
