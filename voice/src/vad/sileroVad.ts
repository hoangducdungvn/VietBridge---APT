// Silero VAD v5 — ONNX Runtime Web wrapper (R2 AI VAD fix).
//
// Silero VAD is a lightweight (1.8 MB) neural network trained to distinguish
// human speech from noise (TV, music, other speakers).  It runs entirely in
// the browser via WebAssembly through ONNX Runtime Web.
//
// Model: silero_vad.onnx (v5, 8 kHz, 512-sample context window)
// Source: https://github.com/snakers4/silero-vad
//
// Usage:
//   const vad = await SileroVad.create('/models/silero_vad.onnx');
//   const prob = await vad.infer(pcm16kHzFloat32);  // 0..1

import * as ort from 'onnxruntime-web';
import ortWasmModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url';
import ortWasmBinaryUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url';

// ---------------------------------------------------------------------------
// Constants — must match the ONNX model's expected input shape
// ---------------------------------------------------------------------------

/** Silero v5 operates on 8 kHz audio internally — we downsample from 16 kHz. */
const MODEL_SAMPLE_RATE = 16000;
/** Context window: 512 samples @ 16 kHz = 32ms per inference call. */
const WINDOW_SIZE_SAMPLES = 512;
/** Hidden state size for the LSTM inside Silero. */
const HIDDEN_SIZE = 128;

// ---------------------------------------------------------------------------
// SileroVad
// ---------------------------------------------------------------------------

export class SileroVad {
  private session: ort.InferenceSession;
  /** LSTM hidden state (h) — carried across infer() calls for continuity. */
  private h: ort.Tensor;
  /** LSTM cell state (c) — carried across infer() calls. */
  private c: ort.Tensor;
  /** Sample rate tensor (constant). */
  private sr: ort.Tensor;

  private constructor(session: ort.InferenceSession) {
    this.session = session;
    this.h = new ort.Tensor('float32', new Float32Array(2 * 1 * HIDDEN_SIZE), [2, 1, HIDDEN_SIZE]);
    this.c = new ort.Tensor('float32', new Float32Array(2 * 1 * HIDDEN_SIZE), [2, 1, HIDDEN_SIZE]);
    this.sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(MODEL_SAMPLE_RATE)]), [1]);
  }

  /**
   * Load the Silero model from the given URL and create a SileroVad instance.
   *
   * Call this once at startup and reuse the returned object for all frames.
   */
  static async create(modelUrl: string): Promise<SileroVad> {
    // Use WASM backend — runs on any browser with WebAssembly support (99%+).
    ort.env.wasm.wasmPaths = {
      mjs: new URL(ortWasmModuleUrl, window.location.href).href,
      wasm: new URL(ortWasmBinaryUrl, window.location.href).href,
    };
    const session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    return new SileroVad(session);
  }

  /**
   * Run inference on a chunk of 16 kHz Float32 audio.
   *
   * The chunk is sliced / zero-padded internally to exactly WINDOW_SIZE_SAMPLES.
   * LSTM states are updated in-place so successive calls maintain temporal
   * context across chunk boundaries.
   *
   * @param frame  Float32Array of 16 kHz mono PCM (any length; ~512 samples ideal)
   * @returns      Speech probability in [0, 1]
   */
  async infer(frame: Float32Array): Promise<number> {
    // Prepare exactly WINDOW_SIZE_SAMPLES worth of input.
    const input = new Float32Array(WINDOW_SIZE_SAMPLES);
    input.set(frame.subarray(0, Math.min(frame.length, WINDOW_SIZE_SAMPLES)));

    const inputTensor = new ort.Tensor('float32', input, [1, WINDOW_SIZE_SAMPLES]);

    const feeds: Record<string, ort.Tensor> = {
      input: inputTensor,
      sr: this.sr,
      h: this.h,
      c: this.c,
    };

    const results = await this.session.run(feeds);

    // Update LSTM states for the next call.
    this.h = results['hn'] as ort.Tensor;
    this.c = results['cn'] as ort.Tensor;

    // Output tensor contains the speech probability scalar.
    const outputData = results['output'].data as Float32Array;
    return Math.max(0, Math.min(1, outputData[0]));
  }

  /**
   * Reset LSTM hidden/cell states (call this between unrelated audio sessions
   * or when a long silence has occurred, to avoid state leakage).
   */
  reset(): void {
    this.h = new ort.Tensor('float32', new Float32Array(2 * 1 * HIDDEN_SIZE), [2, 1, HIDDEN_SIZE]);
    this.c = new ort.Tensor('float32', new Float32Array(2 * 1 * HIDDEN_SIZE), [2, 1, HIDDEN_SIZE]);
  }

  /** Whether the model has been loaded successfully. */
  isReady(): boolean {
    return this.session !== null;
  }
}
