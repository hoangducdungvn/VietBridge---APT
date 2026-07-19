import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

// Isolated test configuration avoids coupling Vitest's Vite version to the app build.
export default defineConfig({
  resolve: {
    alias: {
      // Same alias as vite.config.ts: onnxruntime-web's `exports` hides
      // ./dist/*, and integration tests load the real vietbridge-voice
      // sources (sileroVad.ts imports the runtime artefacts with ?url).
      'onnxruntime-web/dist': fileURLToPath(
        new URL('../voice/node_modules/onnxruntime-web/dist', import.meta.url)
      ),
      '@domain': fileURLToPath(new URL('./src/domain', import.meta.url)),
      '@application': fileURLToPath(new URL('./src/application', import.meta.url)),
      '@infrastructure': fileURLToPath(new URL('./src/infrastructure', import.meta.url)),
      '@presentation': fileURLToPath(new URL('./src/presentation', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url))
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: './tests/setup.ts',
    // Tests exercise the legacy socketio path by default; .env*.local files
    // (dev machines set VITE_TRANSPORT=ws there) must not leak into the suite.
    // The ws path is covered explicitly by MeetingRoomScreen.wsmode.test.tsx.
    env: { VITE_TRANSPORT: 'socketio' }
  }
});
