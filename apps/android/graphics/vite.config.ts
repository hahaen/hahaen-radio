import { fileURLToPath } from 'node:url';

export default {
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/assets/graphics/',
  publicDir: false,
  plugins: [
    {
      name: 'haen-local-geography',
      closeBundle: async () => {
        const { cp, mkdir } = await import('node:fs/promises');
        const target = new URL('../app/src/main/assets/graphics/geography/', import.meta.url);
        await mkdir(target, { recursive: true });
        await cp(new URL('../../web/public/geography/', import.meta.url), target, {
          recursive: true,
        });
      },
    },
  ],
  build: {
    outDir: fileURLToPath(new URL('../app/src/main/assets/graphics', import.meta.url)),
    emptyOutDir: true,
    target: 'chrome120',
  },
};
