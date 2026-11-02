import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(import.meta.dirname, 'src/bridge.ts'),
      name: 'WatchLinkBridgeBundle',
      fileName: () => 'content-bridge.global.js',
      formats: ['iife'],
    },
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: false,
    minify: false,
  },
});
