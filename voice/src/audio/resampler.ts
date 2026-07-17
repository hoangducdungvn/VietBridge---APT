// Resamples Float32 audio from any input sample rate to 16 kHz.
// Converts Float32 → Int16 PCM (signed 16-bit little-endian).
// Computes audio quality metrics per chunk.

/**
 * Per-chunk audio quality metrics.
 */
export interface AudioQuality {
  /** RMS level in dBFS (floored at -96). */
  rms_dbfs: number;
  /** Peak level in dBFS (floored at -96). */
  peak_dbfs: number;
  /** Estimated SNR in dB (speech energy vs noise floor). */
  estimated_snr_db: number;
  /** Ratio of samples at or above 0.99 absolute amplitude. */
  clipping_ratio: number;
}

/** Minimum representable dBFS value (silence floor). */
const MIN_DBFS = -96;

/**
 * Linear-interpolation resampler with Float32→Int16 conversion.
 *
 * Maintains fractional sample position between successive `process()` calls
 * so that a continuous stream is resampled without audible gaps or clicks.
 */
export class Resampler {
  private readonly inputRate: number;
  private readonly outputRate: number;
  /** Ratio: inputRate / outputRate — how far we step through input per output sample. */
  private readonly ratio: number;
  /** Fractional position carried across calls (in input-sample units). */
  private fractionalPosition: number = 0;
  /** Last sample of the previous chunk (for interpolation across chunk boundaries). */
  private lastSample: number = 0;

  constructor(inputSampleRate: number, outputSampleRate: number = 16000) {
    if (inputSampleRate <= 0 || outputSampleRate <= 0) {
      throw new RangeError('Sample rates must be positive');
    }
    this.inputRate = inputSampleRate;
    this.outputRate = outputSampleRate;
    this.ratio = inputSampleRate / outputSampleRate;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Resample a Float32 chunk at `inputRate` and return an Int16 chunk at
   * `outputRate`.
   *
   * The method keeps fractional-position state between calls so that a
   * continuous stream of input chunks produces a gap-free output stream.
   */
  process(input: Float32Array): Int16Array {
    if (input.length === 0) {
      return new Int16Array(0);
    }

    // Fast path: rates match → just convert to Int16
    if (this.inputRate === this.outputRate) {
      return Resampler.floatToInt16(input);
    }

    const resampled = this.resampleLinear(input);
    return Resampler.floatToInt16(resampled);
  }

  /**
   * Compute per-chunk audio quality metrics for a Float32 buffer.
   */
  static computeQuality(samples: Float32Array): AudioQuality {
    if (samples.length === 0) {
      return {
        rms_dbfs: MIN_DBFS,
        peak_dbfs: MIN_DBFS,
        estimated_snr_db: 0,
        clipping_ratio: 0,
      };
    }

    let sumSquares = 0;
    let peak = 0;
    let clipCount = 0;

    for (let i = 0; i < samples.length; i++) {
      const abs = Math.abs(samples[i]);
      sumSquares += samples[i] * samples[i];
      if (abs > peak) peak = abs;
      if (abs >= 0.99) clipCount++;
    }

    const rms = Math.sqrt(sumSquares / samples.length);
    const rms_dbfs = rms > 0 ? Math.max(MIN_DBFS, 20 * Math.log10(rms)) : MIN_DBFS;
    const peak_dbfs = peak > 0 ? Math.max(MIN_DBFS, 20 * Math.log10(peak)) : MIN_DBFS;
    const clipping_ratio = clipCount / samples.length;
    const estimated_snr_db = Resampler.estimateSnr(samples);

    return { rms_dbfs, peak_dbfs, estimated_snr_db, clipping_ratio };
  }

  /**
   * Reset internal resampling state (fractional position + last sample).
   */
  reset(): void {
    this.fractionalPosition = 0;
    this.lastSample = 0;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Linear-interpolation resampler.
   *
   * For each output sample we compute the corresponding (fractional) position
   * in the input buffer and linearly interpolate between the two surrounding
   * input samples.  The fractional remainder is carried into the next call.
   */
  private resampleLinear(input: Float32Array): Float32Array {
    // Number of output samples we can produce from this chunk.
    const outputLength = Math.floor(
      (input.length - this.fractionalPosition) / this.ratio,
    );

    if (outputLength <= 0) {
      // Not enough new input to produce even one output sample — accumulate
      // the fractional position and return empty.
      this.fractionalPosition -= input.length;
      this.lastSample = input[input.length - 1];
      return new Float32Array(0);
    }

    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const pos = this.fractionalPosition + i * this.ratio;
      const idx = Math.floor(pos);
      const frac = pos - idx;

      // Previous sample: either from the current chunk or from the last
      // sample of the previous chunk (when idx < 0 — shouldn't happen — or
      // exactly 0 and we need the sample before index 0).
      const s0 = idx >= 0 ? input[idx] : this.lastSample;
      const s1Idx = idx + 1;
      const s1 = s1Idx < input.length ? input[s1Idx] : input[input.length - 1];

      output[i] = s0 + frac * (s1 - s0);
    }

    // Advance the fractional position past all the samples we consumed.
    this.fractionalPosition =
      this.fractionalPosition + outputLength * this.ratio - input.length;
    this.lastSample = input[input.length - 1];

    return output;
  }

  /**
   * Clamp Float32 samples to [-1, 1] and convert to signed Int16.
   */
  private static floatToInt16(samples: Float32Array): Int16Array {
    const out = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      // Clamp to [-1, 1]
      let s = samples[i];
      if (s > 1) s = 1;
      else if (s < -1) s = -1;
      out[i] = Math.round(s * 32767);
    }
    return out;
  }

  /**
   * Estimate SNR by comparing the RMS of the loudest 10 % of short
   * sub-frames to the RMS of the quietest 10 %.
   *
   * Returns 0 when the signal is entirely silent.
   */
  private static estimateSnr(samples: Float32Array): number {
    // Divide into small sub-frames (e.g. ~2 ms at 16 kHz ≈ 32 samples).
    const SUB_FRAME_SIZE = 32;
    const frameCount = Math.floor(samples.length / SUB_FRAME_SIZE);
    if (frameCount < 2) return 0;

    // Compute RMS energy of each sub-frame.
    const energies: number[] = new Array(frameCount);
    for (let f = 0; f < frameCount; f++) {
      let sum = 0;
      const base = f * SUB_FRAME_SIZE;
      for (let i = 0; i < SUB_FRAME_SIZE; i++) {
        const s = samples[base + i];
        sum += s * s;
      }
      energies[f] = Math.sqrt(sum / SUB_FRAME_SIZE);
    }

    // Sort ascending to pick bottom 10 % (noise) and top 10 % (speech).
    const sorted = energies.slice().sort((a, b) => a - b);

    const tenPercent = Math.max(1, Math.floor(frameCount * 0.1));

    let noiseSum = 0;
    for (let i = 0; i < tenPercent; i++) noiseSum += sorted[i];
    const noiseRms = noiseSum / tenPercent;

    let speechSum = 0;
    for (let i = sorted.length - tenPercent; i < sorted.length; i++) speechSum += sorted[i];
    const speechRms = speechSum / tenPercent;

    // Guard against division by zero / all-silent input.
    if (noiseRms <= 0 || speechRms <= 0) return 0;

    return 20 * Math.log10(speechRms / noiseRms);
  }
}
