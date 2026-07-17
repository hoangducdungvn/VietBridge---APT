import { defineConfig } from 'vite';

export default defineConfig({
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
