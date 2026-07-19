// Voice Activity Detection engine — energy-based (default) or AI-based (Silero)
// state machine per doc §13.
// State transitions: IDLE → POSSIBLE_SPEECH → SPEAKING → POSSIBLE_END → (IDLE)
//
// R2: Supports two probability backends:
//   - 'energy': Fast synchronous computation (Energy + ZCR). Default/fallback.
//   - 'silero': Silero VAD neural network via ONNX Runtime Web. More accurate
//     in noisy environments (distinguishes user voice from TV / other speakers).
//     Set via VadConfig.backend after calling VadEngine.loadSilero().

import { SileroVad } from './sileroVad';
import {
  VadStateMachine,
  type VadEvent,
  type VadState,
} from './vadStateMachine';

export type { VadEvent, VadState } from './vadStateMachine';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VadConfig {
  /** Duration of each audio frame in milliseconds. */
  frameDurationMs: number;
  /** Probability threshold to trigger speech start (upper hysteresis). */
  speechStartThreshold: number;
  /** Probability threshold to trigger speech end (lower hysteresis). */
  speechEndThreshold: number;
  /** Minimum speech duration in ms before confirming speech. */
  minSpeechMs: number;
  /** Pre-roll buffer length in ms (audio kept before speech onset). */
  preRollMs: number;
  /** Hangover silence duration in ms before ending utterance. */
  endSilenceMs: number;
  /** Maximum utterance duration in ms (must stay < Whisper 30 s limit). */
  maxUtteranceMs: number;
  /**
   * R2 — Speech probability backend:
   * - 'energy'  : Energy + ZCR (fast, synchronous, default/fallback)
   * - 'silero'  : Silero VAD neural network (accurate, async, requires model load)
   */
  backend: 'energy' | 'silero';
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: VadConfig = {
  frameDurationMs: 20,
  speechStartThreshold: 0.7, // default (noisy-safe); Studio Mode passes 0.65 (quiet room assumed)
  speechEndThreshold: 0.22, // tolerate soft syllables and room noise dips before ending
  minSpeechMs: 150, // raised 120→150ms: filters mic pops and single clicks
  preRollMs: 400, // raised 200→400ms: keep breath intake + leading consonants ("H" in "Hello")
  endSilenceMs: 1000, // balance natural pauses without making final results feel late
  maxUtteranceMs: 25_000, // still below Whisper's 30s practical limit
  backend: 'energy', // R2: energy by default; loadSilero() switches to 'silero' on success
};

const SILERO_START_THRESHOLD = 0.5;
const SILERO_END_THRESHOLD = 0.35;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Standard logistic sigmoid. */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

// ---------------------------------------------------------------------------
// VadEngine
// ---------------------------------------------------------------------------

export class VadEngine {
  private config: VadConfig;
  private stateMachine: VadStateMachine;

  // Pre-roll circular buffer ---
  private preRollBuffer: Float32Array[];
  private preRollCapacity: number;
  private preRollWriteIdx: number = 0;
  private preRollCount: number = 0;

  private frameCount: number = 0;

  // Keep each detector on its own probability scale. Mixing the raw values
  // caused Energy's ~0.5 silence baseline to mask Silero's EOU threshold.
  private energyProbabilityWindow: number[];
  private sileroProbabilityWindow: number[];
  private windowCapacity: number;

  // Noise floor tracking ---
  private noiseFloorEstimate: number = 1e-10; // running EMA of energy during non-speech
  private noiseFloorInitialised: boolean = false;

  // Scale factor: tuned so ~10 dB above noise floor → probability ~0.7
  // 10 dB ≈ ln(10) ≈ 2.302 in log-energy space.  sigmoid(2.302 * scale) ≈ 0.7
  // 0.7 = 1/(1+exp(-2.302*s))  →  exp(-2.302*s)=3/7  →  s = ln(7/3)/2.302 ≈ 0.369
  // We multiply by a moderate gain to sharpen the curve.
  private readonly ENERGY_SCALE = 3.5;

  // Noise floor EMA coefficient (slow adaptation during silence) ---
  private readonly NOISE_ALPHA = 0.02;

  // R2: Silero AI VAD backend ---
  private silero: SileroVad | null = null;
  /** Last AI-inferred probability (cached for sync access in state machine). */
  private lastSileroProbability = 0;
  /** Continuous PCM waiting to form exact 512-sample Silero v5 windows. */
  private sileroSampleBuffer = new Float32Array(0);
  /** Pending async Silero inference; model calls are kept sequential. */
  private sileroInferring = false;
  private sileroHasResult = false;
  private sileroFailureCount = 0;

  private readonly SILERO_WINDOW_SAMPLES = 512;
  private readonly SILERO_FAILURE_LIMIT = 3;

  constructor(config?: Partial<VadConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stateMachine = new VadStateMachine({
      frameDurationMs: this.config.frameDurationMs,
      minSpeechMs: this.config.minSpeechMs,
      preRollMs: this.config.preRollMs,
      endSilenceMs: this.config.endSilenceMs,
      maxUtteranceMs: this.config.maxUtteranceMs,
      energyStartThreshold: this.config.speechStartThreshold,
      energyEndThreshold: this.config.speechEndThreshold,
      sileroStartThreshold: SILERO_START_THRESHOLD,
      sileroEndThreshold: SILERO_END_THRESHOLD,
    });

    // Pre-roll: number of frames to keep
    this.preRollCapacity = Math.max(
      1,
      Math.ceil(this.config.preRollMs / this.config.frameDurationMs),
    );
    this.preRollBuffer = [];

    // Probability window: at least 120 ms worth of frames
    this.windowCapacity = Math.max(
      1,
      Math.ceil(this.config.minSpeechMs / this.config.frameDurationMs),
    );
    this.energyProbabilityWindow = [];
    this.sileroProbabilityWindow = [];
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Process a single audio frame (expected: 320 samples of Float32 at 16 kHz
   * for a 20 ms frame).
   *
   * Returns a {@link VadEvent} when a state transition occurs, otherwise
   * `null`.
   */
  processFrame(frame: Float32Array, timestampMs: number): VadEvent | null {
    this.frameCount++;

    // 1. Compute frame energy
    const energy = this.computeEnergy(frame);

    // 2. Compute Zero-Crossing Rate
    const zcr = this.computeZCR(frame);

    // 3. Compute speech probability. Capture produces 320-sample/20ms frames,
    //    while Silero v5 requires continuous 512-sample windows. Queue every
    //    sample and run model calls sequentially so frames are never dropped.
    const energyProbability = this.computeSpeechProbability(energy, zcr);
    let sileroProbability: number | null = null;
    if (this.config.backend === 'silero' && this.silero) {
      this.enqueueSileroSamples(frame);
      if (this.sileroHasResult) {
        sileroProbability = this.lastSileroProbability;
      }
    }

    // 4. Smooth Energy and Silero independently. The state machine combines
    // detector decisions, never their raw probability values.
    this.pushProbability(this.energyProbabilityWindow, energyProbability);
    if (sileroProbability === null) {
      this.sileroProbabilityWindow = [];
    } else {
      this.pushProbability(this.sileroProbabilityWindow, sileroProbability);
    }
    const energyAverage = this.windowAverage(this.energyProbabilityWindow);
    const sileroAverage =
      sileroProbability === null
        ? null
        : this.windowAverage(this.sileroProbabilityWindow);

    // 5. Update noise floor during non-speech states
    const state = this.stateMachine.getState();
    if (state === 'IDLE' || state === 'POSSIBLE_END') {
      this.updateNoiseFloor(energy);
    }

    // 6. Maintain pre-roll buffer (always, even during speech for
    //    back-to-back utterance continuation)
    this.pushPreRoll(frame);

    // 7. Run state machine
    const event = this.stateMachine.process(
      {
        energyAverage,
        energyInstant: energyProbability,
        sileroAverage,
        sileroInstant: sileroProbability,
      },
      timestampMs,
      this.preRollCount * this.config.frameDurationMs,
    );
    if (event?.type === 'speech_end') {
      this.energyProbabilityWindow = [];
      this.sileroProbabilityWindow = [];
    }
    return event;
  }

  /** Return the current VAD state. */
  getState(): VadState {
    return this.stateMachine.getState();
  }

  /**
   * R2: Load the Silero VAD model and switch to AI backend.
   *
   * Call this once at startup.  If the model fails to load (e.g. WASM not
   * supported, network error), the engine silently stays on the 'energy'
   * backend so the app continues to work without interruption.
   *
   * @param modelUrl  URL to silero_vad.onnx (e.g. '/models/silero_vad.onnx')
   * @returns true if Silero loaded successfully, false if falling back to energy
   */
  async loadSilero(modelUrl: string): Promise<boolean> {
    try {
      this.silero = await SileroVad.create(modelUrl);
      this.config.backend = 'silero';
      return true;
    } catch (err) {
      console.warn(
        '[VadEngine] Silero load failed, falling back to energy VAD:',
        err,
      );
      this.silero = null;
      this.config.backend = 'energy';
      return false;
    }
  }

  /** Which probability backend is currently active ('energy' or 'silero'). */
  getBackend(): 'energy' | 'silero' {
    return this.config.backend;
  }

  /**
   * Return the frames buffered in the pre-roll ring.  The returned array is
   * ordered oldest → newest.
   */
  getPreRollFrames(): Float32Array[] {
    if (this.preRollCount === 0) return [];

    const frames: Float32Array[] = [];
    const start =
      this.preRollCount < this.preRollCapacity ? 0 : this.preRollWriteIdx;

    for (let i = 0; i < this.preRollCount; i++) {
      const idx = (start + i) % this.preRollCapacity;
      frames.push(this.preRollBuffer[idx]);
    }
    return frames;
  }

  /** Reset the engine to IDLE and clear all buffers. */
  reset(): void {
    this.stateMachine.reset();
    this.preRollBuffer = [];
    this.preRollWriteIdx = 0;
    this.preRollCount = 0;
    this.frameCount = 0;
    this.energyProbabilityWindow = [];
    this.sileroProbabilityWindow = [];
    // Keep noise floor estimate across resets for continuity
    // R2: Reset Silero hidden states too
    this.silero?.reset();
    this.lastSileroProbability = 0;
    this.sileroSampleBuffer = new Float32Array(0);
    this.sileroInferring = false;
    this.sileroHasResult = false;
    this.sileroFailureCount = 0;
  }

  private enqueueSileroSamples(frame: Float32Array): void {
    const combined = new Float32Array(
      this.sileroSampleBuffer.length + frame.length,
    );
    combined.set(this.sileroSampleBuffer);
    combined.set(frame, this.sileroSampleBuffer.length);
    this.sileroSampleBuffer = combined;
    this.runNextSileroWindow();
  }

  private runNextSileroWindow(): void {
    if (
      this.sileroInferring ||
      !this.silero ||
      this.config.backend !== 'silero' ||
      this.sileroSampleBuffer.length < this.SILERO_WINDOW_SAMPLES
    ) {
      return;
    }

    const window = this.sileroSampleBuffer.slice(0, this.SILERO_WINDOW_SAMPLES);
    this.sileroSampleBuffer = this.sileroSampleBuffer.slice(
      this.SILERO_WINDOW_SAMPLES,
    );
    this.sileroInferring = true;

    void this.silero
      .infer(window)
      .then((speechProbability) => {
        this.lastSileroProbability = speechProbability;
        this.sileroHasResult = true;
        this.sileroFailureCount = 0;
      })
      .catch((error: unknown) => {
        this.sileroFailureCount += 1;
        console.warn(
          `[VadEngine] Silero inference failed (${this.sileroFailureCount}/${this.SILERO_FAILURE_LIMIT})`,
          error,
        );
        if (this.sileroFailureCount >= this.SILERO_FAILURE_LIMIT) {
          console.warn(
            '[VadEngine] Falling back to energy VAD after repeated inference failures',
          );
          this.config.backend = 'energy';
          this.silero = null;
          this.sileroSampleBuffer = new Float32Array(0);
          this.sileroHasResult = false;
          this.lastSileroProbability = 0;
          this.sileroProbabilityWindow = [];
        }
      })
      .finally(() => {
        this.sileroInferring = false;
        this.runNextSileroWindow();
      });
  }

  // -----------------------------------------------------------------------
  // Audio analysis helpers
  // -----------------------------------------------------------------------

  /** Mean squared energy of the frame. */
  private computeEnergy(frame: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) {
      sum += frame[i] * frame[i];
    }
    return sum / frame.length;
  }

  /**
   * Zero-Crossing Rate: fraction of adjacent samples with a sign change.
   * High ZCR with moderate energy hints at impact / click noise rather than
   * voiced speech.
   */
  private computeZCR(frame: Float32Array): number {
    if (frame.length < 2) return 0;
    let crossings = 0;
    for (let i = 1; i < frame.length; i++) {
      if (frame[i] >= 0 !== frame[i - 1] >= 0) {
        crossings++;
      }
    }
    return crossings / (frame.length - 1);
  }

  /**
   * Derive a [0, 1] speech probability from energy and ZCR.
   *
   * 1. Raw probability = sigmoid((log(energy) - log(noiseFloor)) * scale)
   * 2. Penalise high-ZCR moderate-energy frames (impact noise).
   */
  private computeSpeechProbability(energy: number, zcr: number): number {
    // Guard against log(0)
    const safeEnergy = Math.max(energy, 1e-20);
    const safeNoise = Math.max(this.noiseFloorEstimate, 1e-20);

    const logDiff = Math.log(safeEnergy) - Math.log(safeNoise);
    let prob = sigmoid(logDiff * this.ENERGY_SCALE);

    // ZCR penalty: if ZCR > 0.5 and energy is only moderately above noise,
    // reduce probability — this is likely a click / impact, not speech.
    if (zcr > 0.5 && logDiff < 4) {
      // Scale down proportionally to how high ZCR is above 0.5
      const penalty = 1 - (zcr - 0.5) * 1.5; // max reduction ~0.25
      prob *= Math.max(penalty, 0.3);
    }

    return prob;
  }

  // -----------------------------------------------------------------------
  // Noise floor
  // -----------------------------------------------------------------------

  /** Exponential moving average update of the noise floor estimate. */
  private updateNoiseFloor(energy: number): void {
    if (!this.noiseFloorInitialised) {
      this.noiseFloorEstimate = energy;
      this.noiseFloorInitialised = true;
      return;
    }
    this.noiseFloorEstimate =
      this.NOISE_ALPHA * energy +
      (1 - this.NOISE_ALPHA) * this.noiseFloorEstimate;
  }

  // -----------------------------------------------------------------------
  // Probability window
  // -----------------------------------------------------------------------

  private pushProbability(window: number[], probability: number): void {
    window.push(probability);
    if (window.length > this.windowCapacity) {
      window.shift();
    }
  }

  private windowAverage(window: number[]): number {
    if (window.length === 0) return 0;
    let sum = 0;
    for (const value of window) sum += value;
    return sum / window.length;
  }

  // -----------------------------------------------------------------------
  // Pre-roll buffer (circular)
  // -----------------------------------------------------------------------

  private pushPreRoll(frame: Float32Array): void {
    if (this.preRollBuffer.length < this.preRollCapacity) {
      this.preRollBuffer.push(frame);
      this.preRollCount++;
    } else {
      this.preRollBuffer[this.preRollWriteIdx] = frame;
      this.preRollCount = Math.min(this.preRollCount + 1, this.preRollCapacity);
    }
    this.preRollWriteIdx = (this.preRollWriteIdx + 1) % this.preRollCapacity;
  }
}
