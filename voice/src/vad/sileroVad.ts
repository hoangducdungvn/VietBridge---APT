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

// Pure-WASM bundle: the default 'onnxruntime-web' entry is the JSEP/WebGPU
// build, which fetches ort-wasm-simd-threaded.jsep.mjs at runtime — Vite dev
// refuses dynamic imports from /public ("can only be referenced via HTML
// tags"), so Silero silently fell back to energy VAD in every session.
// Importing the runtime artefacts with ?url lets Vite serve/bundle them
// properly in BOTH dev and build (no /public self-hosting involved).
import * as ort from 'onnxruntime-web/wasm';
// Vite '?url' asset imports (typed in ../types/ort-assets.d.ts)
import ortWasmUrl from 'onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';
import ortMjsUrl from 'onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url';

// ---------------------------------------------------------------------------
// Constants — must match the ONNX model's expected input shape
// ---------------------------------------------------------------------------

const MODEL_SAMPLE_RATE = 16000;
/** Analysis window: 512 samples @ 16 kHz = 32ms per inference call. */
const WINDOW_SIZE_SAMPLES = 512;
/** Hidden state size for the LSTM inside Silero. */
const HIDDEN_SIZE = 128;
/** v5 REQUIRES 64 samples of the PREVIOUS window prepended to each input
 *  (input shape [1, 576]). Without it the model accepts [1, 512] silently but
 *  outputs ~0 probability even on clear speech (verified numerically:
 *  512-only → mean prob 0.004 on a speech sample; 576-with-context → 0.82). */
const CONTEXT_SIZE = 64;

// ---------------------------------------------------------------------------
// SileroVad
// ---------------------------------------------------------------------------

export class SileroVad {
  private session: ort.InferenceSession;
  /** v5: combined LSTM state tensor [2, 1, 128] — replaces v4's separate h/c. */
  private state: ort.Tensor;
  /** v4 only: LSTM hidden state (h). */
  private h: ort.Tensor;
  /** v4 only: LSTM cell state (c). */
  private c: ort.Tensor;
  /** Sample rate tensor (constant). v5 declares sr as a SCALAR (dims []). */
  private sr: ort.Tensor;
  /** v5: last 64 samples of the previous window (context prefix). */
  private context = new Float32Array(CONTEXT_SIZE);
  /** Sample accumulator — VAD frames are 320 samples, windows are 512. */
  private pending = new Float32Array(0);
  /** Last computed probability, returned while a window is still filling. */
  private lastProbability = 0;
  /** Model API variant, detected from the session's input names. The bundled
   *  silero_vad.onnx is v5 (input/state/sr) — feeding v4 names (h/c) makes
   *  session.run() throw on EVERY frame, which the engine used to swallow
   *  silently: probability stayed 0 and the VAD went completely deaf. */
  private readonly isV5: boolean;

  private constructor(session: ort.InferenceSession) {
    this.session = session;
    this.isV5 = session.inputNames.includes('state');
    this.state = new ort.Tensor('float32', new Float32Array(2 * 1 * HIDDEN_SIZE), [2, 1, HIDDEN_SIZE]);
    this.h = new ort.Tensor('float32', new Float32Array(2 * 1 * HIDDEN_SIZE), [2, 1, HIDDEN_SIZE]);
    this.c = new ort.Tensor('float32', new Float32Array(2 * 1 * HIDDEN_SIZE), [2, 1, HIDDEN_SIZE]);
    this.sr = this.isV5
      ? new ort.Tensor('int64', BigInt64Array.from([BigInt(MODEL_SAMPLE_RATE)]), [])
      : new ort.Tensor('int64', BigInt64Array.from([BigInt(MODEL_SAMPLE_RATE)]), [1]);
  }

  /**
   * Load the Silero model from the given URL and create a SileroVad instance.
   *
   * Call this once at startup and reuse the returned object for all frames.
   */
  static async create(modelUrl: string): Promise<SileroVad> {
    // Use WASM backend — runs on any browser with WebAssembly support (99%+).
    ort.env.wasm.wasmPaths = { mjs: ortMjsUrl, wasm: ortWasmUrl };
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
    // Accumulate incoming audio: the VAD feeds 20ms frames (320 samples) but
    // the model consumes exact 512-sample windows. Padding each 320-sample
    // frame with zeros (the old behaviour) feeds the model 37% dead air.
    const merged = new Float32Array(this.pending.length + frame.length);
    merged.set(this.pending);
    merged.set(frame, this.pending.length);
    this.pending = merged;

    // Not enough for a full window yet — keep the previous probability.
    if (this.pending.length < WINDOW_SIZE_SAMPLES) {
      return this.lastProbability;
    }

    // Consume as many full windows as buffered (normally exactly one).
    let probability = this.lastProbability;
    while (this.pending.length >= WINDOW_SIZE_SAMPLES) {
      const window = this.pending.subarray(0, WINDOW_SIZE_SAMPLES);
      this.pending = this.pending.slice(WINDOW_SIZE_SAMPLES);
      probability = await this.runWindow(window);
    }
    this.lastProbability = probability;
    return probability;
  }

  private async runWindow(window: Float32Array): Promise<number> {
    let inputTensor: ort.Tensor;
    if (this.isV5) {
      // [context(64) | window(512)] = [1, 576]
      const withContext = new Float32Array(CONTEXT_SIZE + WINDOW_SIZE_SAMPLES);
      withContext.set(this.context);
      withContext.set(window, CONTEXT_SIZE);
      this.context = window.slice(WINDOW_SIZE_SAMPLES - CONTEXT_SIZE);
      inputTensor = new ort.Tensor('float32', withContext, [1, CONTEXT_SIZE + WINDOW_SIZE_SAMPLES]);
    } else {
      inputTensor = new ort.Tensor('float32', window.slice(), [1, WINDOW_SIZE_SAMPLES]);
    }

    const feeds: Record<string, ort.Tensor> = this.isV5
      ? { input: inputTensor, sr: this.sr, state: this.state }
      : { input: inputTensor, sr: this.sr, h: this.h, c: this.c };

    const results = await this.session.run(feeds);

    // Update LSTM state(s) for the next call.
    if (this.isV5) {
      this.state = results['stateN'] as ort.Tensor;
    } else {
      this.h = results['hn'] as ort.Tensor;
      this.c = results['cn'] as ort.Tensor;
    }

    // Output tensor contains the speech probability scalar.
    const outputData = results['output'].data as Float32Array;
    return Math.max(0, Math.min(1, outputData[0]));
  }

  /**
   * Reset LSTM hidden/cell states (call this between unrelated audio sessions
   * or when a long silence has occurred, to avoid state leakage).
   */
  reset(): void {
    this.state = new ort.Tensor('float32', new Float32Array(2 * 1 * HIDDEN_SIZE), [2, 1, HIDDEN_SIZE]);
    this.h = new ort.Tensor('float32', new Float32Array(2 * 1 * HIDDEN_SIZE), [2, 1, HIDDEN_SIZE]);
    this.c = new ort.Tensor('float32', new Float32Array(2 * 1 * HIDDEN_SIZE), [2, 1, HIDDEN_SIZE]);
    this.context = new Float32Array(CONTEXT_SIZE);
    this.pending = new Float32Array(0);
    this.lastProbability = 0;
  }

  /** Whether the model has been loaded successfully. */
  isReady(): boolean {
    return this.session !== null;
  }
}
