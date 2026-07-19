// Exact-specifier typings for the onnxruntime-web runtime artefacts imported
// with Vite's '?url' suffix (sileroVad.ts). Deliberately NOT a '*?url'
// wildcard: the frontend compiles these sources too and already has Vite's
// client types — a second wildcard would collide, exact names never do.

declare module 'onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url' {
  const url: string;
  export default url;
}

declare module 'onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url' {
  const url: string;
  export default url;
}
