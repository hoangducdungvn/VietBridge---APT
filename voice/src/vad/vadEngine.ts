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
   * Optional dynamic hangover: consulted on every POSSIBLE_END frame and wins
   * over endSilenceMs when set. Lets the caller extend the hangover when the
   * latest STT partial ends mid-sentence (see vad/endSilencePolicy.ts) without
   * paying a longer flat delay on every utterance.
   */
  endSilencePolicy?: (ctx: {
    speechDurationMs: number;
    silenceDurationMs: number;
    defaultEndSilenceMs: number;
  }) => number;
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
  speechEndThreshold: 0.28,     // lowered 0.35→0.28: cut speech more aggressively when quiet
  minSpeechMs: 150,             // raised 120→150ms: filters mic pops and single clicks
  preRollMs: 400,               // raised 200→400ms: keep breath intake + leading consonants ("H" in "Hello")
  endSilenceMs: 800,            // baseline hangover (contract §13 said 600; raised to 800 after field
                                // tests showed clause-level breath pauses splitting sentences).
                                // endSilencePolicy still shortens to ~480ms on terminal punctuation
                                // and extends on unfinished tails — was flat 2500ms once, which
                                // added 2.5s to EVERY utterance's time-to-translation
  maxUtteranceMs: 20_000,       // hard cap: bounds replay/buffer memory + final decode latency;
                                // UtteranceManager continuation chains handle longer monologues
  backend: 'energy',  // R2: energy by default; loadSilero() switches to 'silero' on success
};

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

  // Anti-deadlock floor recovery (see processFrame step 5) ---
  /** Ring buffer of the last ~2s of frame energies (all states). */
  private recentEnergies: number[] = [];
  private recentEnergiesIdx = 0;
  private readonly RECENT_ENERGY_FRAMES = 100; // 2s @ 20ms
  /** Floor recovery may only engage after this much continuous speech —
   *  normal sentences must never trip it (see processFrame step 5). */
  private readonly FLOOR_RECOVERY_AFTER_MS = 5000;
  /** Non-zero while a stale floor is being ramped back up mid-speech. */
  private floorRecoveryTarget = 0;
  /** Loudest frame energy seen in the current utterance — reference for the
   *  "has the speaker actually stopped?" discriminator. */
  private utteranceSpeechPeak = 0;

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
  /** Pending async Silero inference (avoids overlapping calls). */
  private sileroInferring = false;
  /** Consecutive Silero inference failures — triggers energy fallback at 5. */
  private sileroFailureCount = 0;

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

    // 3. Compute speech probability
    //    R2: If Silero is loaded, kick off async inference and use the
    //    PREVIOUS frame's result synchronously (1-frame lag is imperceptible).
    //    While Silero is initialising or when backend='energy', fall back.
    let probability: number;
    if (this.config.backend === 'silero' && this.silero) {
      probability = this.lastSileroProbability;
      // Kick off inference for the NEXT frame (fire-and-forget)
      if (!this.sileroInferring) {
        this.sileroInferring = true;
        this.silero.infer(frame).then((p) => {
          this.lastSileroProbability = p;
          this.sileroInferring = false;
          this.sileroFailureCount = 0;
        }).catch((err) => {
          this.sileroInferring = false;
          // A silently-broken Silero leaves probability stuck at 0 — the VAD
          // goes completely deaf. Surface the first error, and after repeated
          // failures fall back to the energy backend so capture keeps working.
          this.sileroFailureCount++;
          if (this.sileroFailureCount === 1) {
            console.warn('[VadEngine] Silero inference failed:', err);
          }
          if (this.sileroFailureCount >= 5) {
            console.warn('[VadEngine] Silero failing repeatedly — reverting to energy VAD');
            this.config.backend = 'energy';
            this.silero = null;
          }
        });
      }
    } else {
      probability = this.computeSpeechProbability(energy, zcr);
    }

    // 4. Push into sliding probability window
    this.pushProbability(probability);
    const windowAvg = this.windowAverage();

    // 5. Update noise floor during non-speech states.
    //
    //    Anti-deadlock: the EMA floor is frozen while SPEAKING, and entering
    //    POSSIBLE_END requires a frame ~1.2dB BELOW the floor — so if the
    //    ambient level rises after the floor was learned (browser AGC ramping,
    //    fan, speaker bleed), no frame can ever dip under the stale floor and
    //    the turn only ends at maxUtteranceMs (observed: every utterance in a
    //    noisy session ending with reason=max_duration). When the quietest
    //    frame of the last ~2s sits >8dB above the floor, latch a recovery
    //    target near the ambient mean and ramp the floor up ~+4dB/s until
    //    normal end-of-turn detection works again.
    this.recentEnergies[this.recentEnergiesIdx] = energy;
    this.recentEnergiesIdx = (this.recentEnergiesIdx + 1) % this.RECENT_ENERGY_FRAMES;
    if (this.state === 'IDLE' || this.state === 'POSSIBLE_END') {
      this.floorRecoveryTarget = 0; // EMA is live again — no recovery needed
      this.utteranceSpeechPeak = 0;
      this.updateNoiseFloor(energy);
    } else if (this.recentEnergies.length >= this.RECENT_ENERGY_FRAMES) {
      this.utteranceSpeechPeak = Math.max(this.utteranceSpeechPeak, energy);
      // Deadlock recovery — engages ONLY when ALL THREE hold:
      //   1. the turn has been open unusually long (>5s), AND
      //   2. the loudest frame of the last 2s sits ≥12dB BELOW this
      //      utterance's own speech peak — someone still talking always has
      //      frames near their peak, so a long sentence can never trip this
      //      (a duration-only gate used to chop real speech at ~11s), AND
      //   3. the quietest recent frame is still >8dB above the frozen floor
      //      (otherwise the normal end-of-turn path already works).
      // Then ramp the floor toward the ambient level so the turn can close
      // instead of hanging to maxUtteranceMs.
      const speakerStopped =
        Math.max(...this.recentEnergies) < this.utteranceSpeechPeak / 16;
      if (
        timestampMs - this.speechStartTime > this.FLOOR_RECOVERY_AFTER_MS &&
        speakerStopped
      ) {
        const recentMin = Math.min(...this.recentEnergies);
        if (recentMin > this.noiseFloorEstimate * 6) {
          this.floorRecoveryTarget = recentMin * 2.5;
        }
      }
      if (this.floorRecoveryTarget > this.noiseFloorEstimate) {
        this.noiseFloorEstimate = Math.min(
          this.floorRecoveryTarget,
          this.noiseFloorEstimate * 1.02,
        );
      }
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
    this.recentEnergies = [];
    this.recentEnergiesIdx = 0;
    this.floorRecoveryTarget = 0;
    this.utteranceSpeechPeak = 0;
    // Keep noise floor estimate across resets for continuity
    // R2: Reset Silero hidden states too
    this.silero?.reset();
    this.lastSileroProbability = 0;
    this.sileroInferring = false;
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
    switch (this.state) {
      // -----------------------------------------------------------------
      case 'IDLE': {
        if (windowAvg > this.config.speechStartThreshold) {
          this.state = 'POSSIBLE_SPEECH';
          this.possibleSpeechAccMs = this.config.frameDurationMs;
          this.speechStartTime = timestampMs;
        }
        return null;
      }

      // -----------------------------------------------------------------
      case 'POSSIBLE_SPEECH': {
        if (windowAvg > this.config.speechStartThreshold) {
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

        if (windowAvg < this.config.speechEndThreshold) {
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

        if (windowAvg > this.config.speechStartThreshold) {
          // Speech resumed
          this.state = 'SPEAKING';
          return {
            type: 'speech_continue',
            speechProbability: instantProb,
            timestampMs,
          };
        }

        const endSilenceMs =
          this.config.endSilencePolicy?.({
            speechDurationMs: speechDuration,
            silenceDurationMs: silenceDuration,
            defaultEndSilenceMs: this.config.endSilenceMs,
          }) ?? this.config.endSilenceMs;
        if (silenceDuration >= endSilenceMs) {
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
