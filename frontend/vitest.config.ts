import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

// Isolated test configuration avoids coupling Vitest's Vite version to the app build.
export default defineConfig({
  resolve: {
    alias: {
      '@domain': fileURLToPath(new URL('./src/domain', import.meta.url)),
      '@application': fileURLToPath(new URL('./src/application', import.meta.url)),
      '@infrastructure': fileURLToPath(new URL('./src/infrastructure', import.meta.url)),
      '@presentation': fileURLToPath(new URL('./src/presentation', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url))
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: './tests/setup.ts'
  }
});
