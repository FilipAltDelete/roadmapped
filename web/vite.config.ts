// vitest's defineConfig, not vite's: it is the one that knows the `test` key.
import { defineConfig } from 'vitest/config';

/**
 * Relative asset paths, so a build can be served from a subdirectory. GitHub
 * Pages publishes under `/<repo>/`, and an absolute base would break every
 * asset reference including the WebAssembly module.
 */
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    // The engine is fetched at runtime rather than inlined, so the browser can
    // cache it separately from the app shell. It changes far less often.
    assetsInlineLimit: 4096,
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
  },
});
