import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  publicDir: false,
  resolve: {
    alias: { '@discourse-mini-app/sdk': path('../../../.local/linuxdo/sdk/index.mjs') },
  },
  plugins: [react()],
  build: {
    outDir: path('./dist/bundle'),
    target: 'es2022',
    cssCodeSplit: false,
    lib: {
      entry: path('./main.tsx'),
      name: 'HaenMiniApp',
      formats: ['iife'],
      fileName: () => 'app.js',
      cssFileName: 'app',
    },
  },
});
