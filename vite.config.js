import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    target: 'esnext',
    emptyOutDir: true,
    outDir: resolve(__dirname, 'src/mkdocs_sidecode/assets'),
    rollupOptions: {
      input: {
        runtime: resolve(__dirname, 'frontend/src/runtime.js'),
        styles: resolve(__dirname, 'frontend/src/styles.css'),
      },
      output: {
        entryFileNames: 'runtime.js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'styles.css') {
            return 'styles.css';
          }
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['frontend/src/**/*.test.js'],
  },
});
