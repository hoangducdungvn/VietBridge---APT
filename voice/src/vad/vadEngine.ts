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
import { selectVadProbability } from './vadProbability';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VadState = 'IDLE' | 'POSSIBLE_SPEECH' | 'SPEAKING' | 'POSSIBLE_END';

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

export interface VadEvent {
  type: 'speech_start' | 'speech_end' | 'speech_continue';
  speechProbability: number;
  timestampMs: number;
  /** How many ms of pre-roll audio are available (speech_start only). */
  preRollMs?: number;
  /** Why the utterance ended (speech_end only). */
  reason?: 'vad_silence' | 'max_duration';
  /** How long the trailing silence was in ms (speech_end only). */
  silenceDurationMs?: number;
  /** Total speech duration in ms (speech_end only). */
  speechDurationMs?: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: VadConfig = {
  frameDurationMs: 20,
  speechStartThreshold: 0.70,   // default (noisy-safe); Studio Mode passes 0.65 (quiet room assumed)
  speechEndThreshold: 0.22,     // tolerate soft syllables and room noise dips before ending
  minSpeechMs: 150,             // raised 120→150ms: filters mic pops and single clicks
  preRollMs: 400,               // raised 200→400ms: keep breath intake + leading consonants ("H" in "Hello")
  endSilenceMs: 1000,           // balance natural pauses without making final results feel late
  maxUtteranceMs: 25_000,       // still below Whisper's 30s practical limit
  backend: 'energy',  // R2: energy by default; loadSilero() switches to 'silero' on success
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
  private state: VadState = 'IDLE';
  private config: VadConfig;

  // Pre-roll circular buffer ---
  private preRollBuffer: Float32Array[];
  private preRollCapacity: number;
  private preRollWriteIdx: number = 0;
  private preRollCount: number = 0;

  // Timing bookkeeping ---
  private speechStartTime: number = 0;
  private silenceStartTime: number = 0;
  private frameCount: number = 0;

  // Probability sliding window (≥120 ms, i.e. ≥6 frames @ 20 ms) ---
  private probabilityWindow: number[];
  private windowCapacity: number;

  // Noise floor tracking ---
  private noiseFloorEstimate: number = 1e-10; // running EMA of energy during non-speech
  private noiseFloorInitialised: boolean = false;

  // Accumulator for POSSIBLE_SPEECH duration ---
  private possibleSpeechAccMs: number = 0;

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
    this.probabilityWindow = [];
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
    let probability: number;
    if (this.config.backend === 'silero' && this.silero) {
      this.enqueueSileroSamples(frame);
      // Energy bridges model startup only. Once Silero has a result it must be
      // authoritative, otherwise a ~0.5 silence energy score can permanently
      // mask Silero's <0.35 end-of-utterance signal.
      probability = selectVadProbability(
        energyProbability,
        this.sileroHasResult ? this.lastSileroProbability : null,
      );
    } else {
      probability = energyProbability;
    }

    // 4. Push into sliding probability window
    this.pushProbability(probability);
    const windowAvg = this.windowAverage();

    // 5. Update noise floor during non-speech states
    if (this.state === 'IDLE' || this.state === 'POSSIBLE_END') {
      this.updateNoiseFloor(energy);
    }

    // 6. Maintain pre-roll buffer (always, even during speech for
    //    back-to-back utterance continuation)
    this.pushPreRoll(frame);

    // 7. Run state machine
    return this.transition(windowAvg, probability, timestampMs);
  }

  /** Return the current VAD state. */
  getState(): VadState {
    return this.state;
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
      console.warn('[VadEngine] Silero load failed, falling back to energy VAD:', err);
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
      this.preRollCount < this.preRollCapacity
        ? 0
        : this.preRollWriteIdx;

    for (let i = 0; i < this.preRollCount; i++) {
      const idx = (start + i) % this.preRollCapacity;
      frames.push(this.preRollBuffer[idx]);
    }
    return frames;
  }

  /** Reset the engine to IDLE and clear all buffers. */
  reset(): void {
    this.state = 'IDLE';
    this.preRollBuffer = [];
    this.preRollWriteIdx = 0;
    this.preRollCount = 0;
    this.speechStartTime = 0;
    this.silenceStartTime = 0;
    this.frameCount = 0;
    this.probabilityWindow = [];
    this.possibleSpeechAccMs = 0;
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
    const combined = new Float32Array(this.sileroSampleBuffer.length + frame.length);
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
    this.sileroSampleBuffer = this.sileroSampleBuffer.slice(this.SILERO_WINDOW_SAMPLES);
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
          console.warn('[VadEngine] Falling back to energy VAD after repeated inference failures');
          this.config.backend = 'energy';
          this.silero = null;
          this.sileroSampleBuffer = new Float32Array(0);
          this.sileroHasResult = false;
          this.lastSileroProbability = 0;
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
      if ((frame[i] >= 0) !== (frame[i - 1] >= 0)) {
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

  private pushProbability(p: number): void {
    this.probabilityWindow.push(p);
    if (this.probabilityWindow.length > this.windowCapacity) {
      this.probabilityWindow.shift();
    }
  }

  private windowAverage(): number {
    if (this.probabilityWindow.length === 0) return 0;
    let sum = 0;
    for (const v of this.probabilityWindow) sum += v;
    return sum / this.probabilityWindow.length;
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
    this.preRollWriteIdx =
      (this.preRollWriteIdx + 1) % this.preRollCapacity;
  }

  // -----------------------------------------------------------------------
  // State machine
  // -----------------------------------------------------------------------

  private transition(
    windowAvg: number,
    instantProb: number,
    timestampMs: number,
  ): VadEvent | null {
    const speechStartThreshold =
      this.config.backend === 'silero'
        ? SILERO_START_THRESHOLD
        : this.config.speechStartThreshold;
    const speechEndThreshold =
      this.config.backend === 'silero'
        ? SILERO_END_THRESHOLD
        : this.config.speechEndThreshold;

    switch (this.state) {
      // -----------------------------------------------------------------
      case 'IDLE': {
        if (windowAvg > speechStartThreshold) {
          this.state = 'POSSIBLE_SPEECH';
          this.possibleSpeechAccMs = this.config.frameDurationMs;
          this.speechStartTime = timestampMs;
        }
        return null;
      }

      // -----------------------------------------------------------------
      case 'POSSIBLE_SPEECH': {
        if (windowAvg > speechStartThreshold) {
          this.possibleSpeechAccMs += this.config.frameDurationMs;

          if (this.possibleSpeechAccMs >= this.config.minSpeechMs) {
            // Confirmed speech
            this.state = 'SPEAKING';
            const preRollAvailableMs =
              this.preRollCount * this.config.frameDurationMs;
            return {
              type: 'speech_start',
              speechProbability: instantProb,
              timestampMs,
              preRollMs: Math.min(preRollAvailableMs, this.config.preRollMs),
            };
          }
        } else {
          // Dropped below threshold — false alarm
          this.state = 'IDLE';
          this.possibleSpeechAccMs = 0;
        }
        return null;
      }

      // -----------------------------------------------------------------
      case 'SPEAKING': {
        const elapsed = timestampMs - this.speechStartTime;

        // Max utterance guard
        if (elapsed >= this.config.maxUtteranceMs) {
          this.state = 'IDLE';
          this.possibleSpeechAccMs = 0;
          this.probabilityWindow = [];
          return {
            type: 'speech_end',
            speechProbability: instantProb,
            timestampMs,
            reason: 'max_duration',
            speechDurationMs: elapsed,
            silenceDurationMs: 0,
          };
        }

        if (windowAvg < speechEndThreshold) {
          this.state = 'POSSIBLE_END';
          this.silenceStartTime = timestampMs;
        }
        return null;
      }

      // -----------------------------------------------------------------
      case 'POSSIBLE_END': {
        const silenceDuration = timestampMs - this.silenceStartTime;
        const speechDuration = timestampMs - this.speechStartTime;

        // Max utterance guard even during possible end
        if (speechDuration >= this.config.maxUtteranceMs) {
          this.state = 'IDLE';
          this.possibleSpeechAccMs = 0;
          this.probabilityWindow = [];
          return {
            type: 'speech_end',
            speechProbability: instantProb,
            timestampMs,
            reason: 'max_duration',
            speechDurationMs: speechDuration,
            silenceDurationMs: silenceDuration,
          };
        }

        if (windowAvg > speechStartThreshold) {
          // Speech resumed
          this.state = 'SPEAKING';
          return {
            type: 'speech_continue',
            speechProbability: instantProb,
            timestampMs,
          };
        }

        if (silenceDuration >= this.config.endSilenceMs) {
          // Confirmed silence → end utterance
          this.state = 'IDLE';
          this.possibleSpeechAccMs = 0;
          this.probabilityWindow = [];
          return {
            type: 'speech_end',
            speechProbability: instantProb,
            timestampMs,
            reason: 'vad_silence',
            silenceDurationMs: silenceDuration,
            speechDurationMs: speechDuration,
          };
        }

        return null;
      }

      default:
        return null;
    }
  }
}
