import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const lanEnv = loadEnv(mode, process.cwd(), 'LAN_');
  const certificatePath = lanEnv.LAN_HTTPS_CERT_PATH;
  const keyPath = lanEnv.LAN_HTTPS_KEY_PATH;
  if ((certificatePath === undefined) !== (keyPath === undefined)) {
    throw new Error('LAN_HTTPS_CERT_PATH and LAN_HTTPS_KEY_PATH must be configured together.');
  }
  const backendTarget = lanEnv.LAN_PROXY_BACKEND_URL ?? 'http://127.0.0.1:3000';
  const https =
    certificatePath && keyPath
      ? {
          cert: readFileSync(resolve(process.cwd(), certificatePath)),
          key: readFileSync(resolve(process.cwd(), keyPath))
        }
      : undefined;

  return {
    plugins: [react()],
    optimizeDeps: {
      // ort's runtime .mjs uses top-level await and must NOT be pre-bundled
      // by esbuild — it is fetched at runtime via the ?url imports in
      // ../voice/src/vad/sileroVad.ts. Same exclusion as voice/vite.config.ts.
      exclude: ['onnxruntime-web'],
    },
    server: {
      host: '0.0.0.0',
      https,
      port: 5173,
      proxy: {
        '/api': { changeOrigin: true, target: backendTarget },
        '/health': { changeOrigin: true, target: backendTarget },
        '/socket.io': { changeOrigin: true, target: backendTarget, ws: true }
      },
      strictPort: true
    },
    resolve: {
      alias: {
        // onnxruntime-web's `exports` hides ./dist/* — sileroVad.ts (compiled
        // from ../voice via the file: dependency) imports the runtime
        // .mjs/.wasm with `?url`. MUST resolve inside ../voice/node_modules:
        // that is the 1.27 copy the voice sources actually import; the copy in
        // ./node_modules is 1.14 hoisted from the unused @ricky0123/vad-web
        // placeholder and has no .mjs loaders at all.
        'onnxruntime-web/dist': fileURLToPath(
          new URL('../voice/node_modules/onnxruntime-web/dist', import.meta.url)
        ),
        '@domain': fileURLToPath(new URL('./src/domain', import.meta.url)),
        '@application': fileURLToPath(new URL('./src/application', import.meta.url)),
        '@infrastructure': fileURLToPath(new URL('./src/infrastructure', import.meta.url)),
        '@presentation': fileURLToPath(new URL('./src/presentation', import.meta.url)),
        '@shared': fileURLToPath(new URL('./src/shared', import.meta.url))
      }
    }
  };
});
