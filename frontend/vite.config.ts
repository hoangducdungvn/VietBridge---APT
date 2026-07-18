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
        '@domain': fileURLToPath(new URL('./src/domain', import.meta.url)),
        '@application': fileURLToPath(new URL('./src/application', import.meta.url)),
        '@infrastructure': fileURLToPath(new URL('./src/infrastructure', import.meta.url)),
        '@presentation': fileURLToPath(new URL('./src/presentation', import.meta.url)),
        '@shared': fileURLToPath(new URL('./src/shared', import.meta.url))
      }
    }
  };
});
