import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: [
      // onnxruntime-web's package `exports` hides ./dist/* — but sileroVad.ts
      // must import the runtime .mjs/.wasm with `?url` so Vite serves/bundles
      // them (self-hosting in /public breaks: ort dynamic-imports the .mjs and
      // Vite forbids importing /public assets). Bypass exports resolution.
      {
        find: /^onnxruntime-web\/dist\/(.+)$/,
        replacement: fileURLToPath(
          new URL('./node_modules/onnxruntime-web/dist/$1', import.meta.url),
        ),
      },
    ],
  },
  server: {
    port: 5173,
    headers: {
      // Required for SharedArrayBuffer (WASM threads in onnxruntime-web)
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    // Let onnxruntime-web handle its own WASM loading — don't bundle it
    exclude: ['onnxruntime-web'],
  },
  assetsInclude: ['**/*.onnx'],
});
