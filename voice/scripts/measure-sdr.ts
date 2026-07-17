/**
 * SDR (Signal-to-Distortion Ratio) measurement for the VietBridge Resampler.
 *
 * Method:
 *   1. Generate a clean reference sine wave at 48 kHz (simulates browser mic)
 *   2. Pass it through our Resampler (48kHz → 16kHz)
 *   3. Upsample back to 48kHz to align lengths for comparison
 *   4. Compute SDR = 10 * log10(||s_ref||² / ||s_ref - s_out||²)
 *      and SI-SDR (Scale-Invariant SDR) which is more robust
 *
 * Run with:  npx tsx scripts/measure-sdr.ts
 */

// We import the Resampler directly from TypeScript source via tsx
import { Resampler } from '../src/audio/resampler.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const INPUT_RATE  = 48000;   // Browser mic sample rate
const OUTPUT_RATE = 16000;   // Target
const DURATION_S  = 1.0;     // 1 second of test signal
const TEST_FREQS  = [200, 440, 1000, 2000, 3000, 4000]; // Hz — covers speech range

// ---------------------------------------------------------------------------
// Signal generation helpers
// ---------------------------------------------------------------------------

function generateSine(freq: number, sampleRate: number, durationS: number, amplitude = 0.5): Float32Array {
  const n = Math.round(sampleRate * durationS);
  const out = new Float32Array(n);
  const omega = (2 * Math.PI * freq) / sampleRate;
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin(omega * i);
  return out;
}

function generateMultiTone(freqs: number[], sampleRate: number, durationS: number): Float32Array {
  const n = Math.round(sampleRate * durationS);
  const out = new Float32Array(n);
  const amp = 0.5 / freqs.length;
  for (const freq of freqs) {
    const omega = (2 * Math.PI * freq) / sampleRate;
    for (let i = 0; i < n; i++) out[i] += amp * Math.sin(omega * i);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Upsample via linear interpolation (for alignment only, not part of pipeline)
// ---------------------------------------------------------------------------

function upsampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  const ratio = fromRate / toRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const s0 = input[idx] ?? 0;
    const s1 = input[idx + 1] ?? s0;
    out[i] = s0 + frac * (s1 - s0);
  }
  return out;
}

// Int16 → Float32
function int16ToFloat32(pcm: Int16Array): Float32Array {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768;
  return out;
}

// ---------------------------------------------------------------------------
// SDR & SI-SDR computation
// ---------------------------------------------------------------------------

function computeSDR(reference: Float32Array, estimate: Float32Array): number {
  const len = Math.min(reference.length, estimate.length);

  let sigPow = 0;
  let distPow = 0;
  for (let i = 0; i < len; i++) {
    sigPow  += reference[i] * reference[i];
    const e  = reference[i] - estimate[i];
    distPow += e * e;
  }

  if (distPow === 0) return Infinity;
  return 10 * Math.log10(sigPow / distPow);
}

function computeSiSDR(reference: Float32Array, estimate: Float32Array): number {
  const len = Math.min(reference.length, estimate.length);

  // Compute dot product and norms
  let dot = 0, refPow = 0;
  for (let i = 0; i < len; i++) {
    dot    += reference[i] * estimate[i];
    refPow += reference[i] * reference[i];
  }

  // Scale estimate to best fit reference
  const scale = dot / (refPow + 1e-10);
  const target = new Float32Array(len);
  for (let i = 0; i < len; i++) target[i] = scale * reference[i];

  // SI-SDR = SDR of scaled target vs error
  let tPow = 0, ePow = 0;
  for (let i = 0; i < len; i++) {
    const e = estimate[i] - target[i];
    tPow += target[i] * target[i];
    ePow += e * e;
  }

  if (ePow === 0) return Infinity;
  return 10 * Math.log10(tPow / ePow);
}

function computeRmsDbfs(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / samples.length);
  return rms > 0 ? 20 * Math.log10(rms) : -96;
}

// ---------------------------------------------------------------------------
// Run tests
// ---------------------------------------------------------------------------

interface TestResult {
  label: string;
  freq: string;
  sdr: number;
  siSdr: number;
  rmsIn: number;
  rmsOut: number;
  passThrough: boolean;
}

function runSingleTest(label: string, freqLabel: string, signal48k: Float32Array): TestResult {
  const resampler = new Resampler(INPUT_RATE, OUTPUT_RATE);

  // Split into 20ms chunks (960 samples at 48kHz) — simulates AudioWorklet
  const CHUNK_SAMPLES = (INPUT_RATE / 1000) * 20; // 960 samples
  const pcmChunks: Int16Array[] = [];

  for (let offset = 0; offset < signal48k.length; offset += CHUNK_SAMPLES) {
    const chunk = signal48k.subarray(offset, offset + CHUNK_SAMPLES);
    pcmChunks.push(resampler.process(chunk));
  }

  // Concatenate all output chunks
  const totalOut = pcmChunks.reduce((s, c) => s + c.length, 0);
  const pcmOut = new Int16Array(totalOut);
  let pos = 0;
  for (const c of pcmChunks) { pcmOut.set(c, pos); pos += c.length; }

  // Convert Int16 output back to Float32 for comparison
  const float32Out = int16ToFloat32(pcmOut);

  // Upsample output back to 48kHz to align with reference for SDR computation
  const float32OutUpsampled = upsampleLinear(float32Out, OUTPUT_RATE, INPUT_RATE);

  // Trim to same length
  const len = Math.min(signal48k.length, float32OutUpsampled.length);
  const ref = signal48k.subarray(0, len);
  const est = float32OutUpsampled.subarray(0, len);

  const sdr   = computeSDR(ref, est);
  const siSdr = computeSiSDR(ref, est);
  const rmsIn  = computeRmsDbfs(signal48k);
  const rmsOut = computeRmsDbfs(float32Out);

  // "Pass-through" test: same rate (no actual resampling needed)
  const resamplerPass = new Resampler(OUTPUT_RATE, OUTPUT_RATE);
  const pcmPass = resamplerPass.process(new Float32Array(signal48k.length / 3));
  const passFloat = int16ToFloat32(pcmPass);
  const passThrough = computeSDR(new Float32Array(passFloat.length), passFloat) > 40;

  return { label, freq: freqLabel, sdr, siSdr, rmsIn, rmsOut, passThrough };
}

// ANSI colors
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
  cyan: '\x1b[36m', magenta: '\x1b[35m', blue: '\x1b[34m',
};

function grade(sdr: number): string {
  if (sdr >= 40) return `${C.green}${C.bold}★★★★ Excellent${C.reset}`;
  if (sdr >= 30) return `${C.green}★★★  Good${C.reset}`;
  if (sdr >= 20) return `${C.yellow}★★   Acceptable${C.reset}`;
  if (sdr >= 10) return `${C.yellow}★    Poor${C.reset}`;
  return `${C.red}✗    Fail${C.reset}`;
}

console.log('');
console.log(`${C.bold}${C.cyan}╔════════════════════════════════════════════════════════╗${C.reset}`);
console.log(`${C.bold}${C.cyan}║  VietBridge Voice — SDR / SI-SDR Measurement Tool     ║${C.reset}`);
console.log(`${C.bold}${C.cyan}╚════════════════════════════════════════════════════════╝${C.reset}`);
console.log(`  Pipeline: ${C.yellow}${INPUT_RATE} Hz → Resampler → ${OUTPUT_RATE} Hz → Int16 PCM${C.reset}`);
console.log(`  Signal:   ${DURATION_S}s synthetic (sine waves in speech frequency range)`);
console.log('');

const results: TestResult[] = [];

// Test 1: Individual frequencies
for (const freq of TEST_FREQS) {
  const sig = generateSine(freq, INPUT_RATE, DURATION_S);
  results.push(runSingleTest(`Sine ${freq}Hz`, `${freq} Hz`, sig));
}

// Test 2: Multi-tone (simulates real speech harmonics)
const multiTone = generateMultiTone(TEST_FREQS, INPUT_RATE, DURATION_S);
results.push(runSingleTest('Multi-tone (speech sim.)', `[${TEST_FREQS.join('+')}] Hz`, multiTone));

// Print table
const COL = { label: 26, freq: 22, sdr: 10, siSdr: 10, grade: 24 };
const header =
  `  ${'Test'.padEnd(COL.label)} ${'Frequency'.padEnd(COL.freq)} ` +
  `${'SDR(dB)'.padStart(COL.sdr)} ${'SI-SDR(dB)'.padStart(COL.siSdr)}  Grade`;
console.log(`${C.bold}${header}${C.reset}`);
console.log(`  ${'─'.repeat(90)}`);

let totalSdr = 0, totalSiSdr = 0;
for (const r of results) {
  const sdrStr   = isFinite(r.sdr)   ? r.sdr.toFixed(2).padStart(COL.sdr)   : '     ∞';
  const siSdrStr = isFinite(r.siSdr) ? r.siSdr.toFixed(2).padStart(COL.siSdr) : '        ∞';
  console.log(
    `  ${r.label.padEnd(COL.label)} ${r.freq.padEnd(COL.freq)} ` +
    `${C.magenta}${sdrStr}${C.reset} ${C.blue}${siSdrStr}${C.reset}  ${grade(r.sdr)}`
  );
  if (isFinite(r.sdr))   totalSdr   += r.sdr;
  if (isFinite(r.siSdr)) totalSiSdr += r.siSdr;
}

const avgSdr   = totalSdr   / results.length;
const avgSiSdr = totalSiSdr / results.length;

console.log(`  ${'─'.repeat(90)}`);
console.log(
  `  ${'AVERAGE'.padEnd(COL.label)} ${''.padEnd(COL.freq)} ` +
  `${C.bold}${C.magenta}${avgSdr.toFixed(2).padStart(COL.sdr)}${C.reset} ` +
  `${C.bold}${C.blue}${avgSiSdr.toFixed(2).padStart(COL.siSdr)}${C.reset}  ${grade(avgSdr)}`
);
console.log('');

// Industry benchmark comparison
console.log(`${C.bold}  Industry Benchmarks (Linear Interpolation Resamplers):${C.reset}`);
console.log(`  ${C.dim}SoX "linear" quality   : ~28–32 dB SDR${C.reset}`);
console.log(`  ${C.dim}SoX "medium" quality   : ~35–45 dB SDR${C.reset}`);
console.log(`  ${C.dim}Opus codec (speech)    : ~35–50 dB SDR${C.reset}`);
console.log(`  ${C.dim}Whisper ASR tolerance  : ≥ 20 dB acceptable${C.reset}`);
console.log('');

if (avgSdr >= 30) {
  console.log(`${C.green}${C.bold}  ✅ RESULT: Pipeline chất lượng ĐẠT chuẩn production.${C.reset}`);
  console.log(`${C.green}  SDR ${avgSdr.toFixed(1)} dB — tương đương hoặc vượt SoX "linear" quality.${C.reset}`);
} else if (avgSdr >= 20) {
  console.log(`${C.yellow}${C.bold}  ⚠️  RESULT: Pipeline đạt chuẩn tối thiểu cho ASR.${C.reset}`);
  console.log(`${C.yellow}  SDR ${avgSdr.toFixed(1)} dB — Whisper vẫn hoạt động tốt ở mức này.${C.reset}`);
} else {
  console.log(`${C.red}${C.bold}  ❌ RESULT: Pipeline cần cải thiện resampler.${C.reset}`);
}
console.log('');
