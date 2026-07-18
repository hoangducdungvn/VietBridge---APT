// E2E latency benchmark: WAV → gateway (raw WS, realtime pacing) → STT → translation.
//
// Measures, per run:
//   firstPartial   — speech start → first stt.partial on the wire (TTFT for captions)
//   finalGap       — utterance.end sent → stt.final received
//   translationGap — stt.final → translation.final
//   stopToXlat     — utterance.end sent → translation.final (perceived, minus VAD hangover)
//
// NOTE: with a real mic, add the VAD end-silence hangover (~480-1100ms tiered)
// to stopToXlat for the true "stopped talking → translation visible" number.
//
// Usage: npx tsx scripts/measure_e2e.ts [runsPerFile=3]

import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';
import { encodeAudioFrame } from '../src/protocol/packetizer';
import { PROTOCOL_VERSION } from '../src/protocol/types';

const GATEWAY_URL = process.env.MOCK_GATEWAY_URL || 'ws://localhost:8081';
const RUNS = Number.parseInt(process.argv[2] ?? '3', 10);

interface TestFile { file: string; lang: 'vi' | 'en' }
const TEST_SET: TestFile[] = [
  { file: '../stt/tests/sample_vi_neural.wav', lang: 'vi' },
  { file: '../stt/tests/sample_en.wav', lang: 'en' },
  { file: '../stt/tests/sample_en_human.wav', lang: 'en' },
];

interface RunResult {
  file: string;
  lang: string;
  audioSec: number;
  firstPartialMs: number | null;
  partialCount: number;
  avgPartialAsrMs: number | null;
  finalGapMs: number | null;
  finalAsrMs: number | null;
  translationGapMs: number | null;
  translationModelMs: number | null;
  stopToXlatMs: number | null;
  finalText: string;
  translatedText: string;
}

function loadPcm(wavPath: string): Int16Array {
  const buf = fs.readFileSync(wavPath);
  const off = buf.subarray(0, 4).toString() === 'RIFF' ? 44 : 0;
  const pcm = buf.subarray(off);
  return new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function runOnce(test: TestFile, runIdx: number): Promise<RunResult> {
  const int16 = loadPcm(path.resolve(process.cwd(), test.file));
  const audioSec = int16.length / 16000;
  const result: RunResult = {
    file: path.basename(test.file), lang: test.lang, audioSec,
    firstPartialMs: null, partialCount: 0, avgPartialAsrMs: null,
    finalGapMs: null, finalAsrMs: null, translationGapMs: null,
    translationModelMs: null, stopToXlatMs: null, finalText: '', translatedText: '',
  };
  const partialAsr: number[] = [];

  const ws = new WebSocket(GATEWAY_URL);
  let tSpeechStart = 0;
  let tEndSent = 0;
  let tFinal = 0;

  const done = new Promise<void>((resolveDone, rejectDone) => {
    const timeout = setTimeout(() => rejectDone(new Error('timeout waiting for translation.final')), 30_000);

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const evt = JSON.parse(data.toString());
      const now = Date.now();
      if (evt.type === 'stt.partial') {
        if (result.firstPartialMs === null) result.firstPartialMs = now - tSpeechStart;
        result.partialCount++;
        if (typeof evt.asr_latency_ms === 'number') partialAsr.push(evt.asr_latency_ms);
      } else if (evt.type === 'stt.final') {
        tFinal = now;
        result.finalGapMs = now - tEndSent;
        result.finalAsrMs = typeof evt.asr_latency_ms === 'number' ? evt.asr_latency_ms : null;
        result.finalText = evt.text ?? '';
      } else if (evt.type === 'translation.final') {
        result.translationGapMs = tFinal ? now - tFinal : null;
        result.stopToXlatMs = now - tEndSent;
        result.translationModelMs = evt.translation_latency_ms ?? null;
        result.translatedText = evt.translated_text ?? '';
        clearTimeout(timeout);
        ws.close();
        resolveDone();
      } else if (evt.type === 'stt.error') {
        clearTimeout(timeout);
        ws.close();
        rejectDone(new Error(`stt.error: ${evt.message}`));
      }
    });
    ws.on('error', (e) => { clearTimeout(timeout); rejectDone(e); });
  });

  await new Promise<void>((resolveOpen, rejectOpen) => {
    ws.once('open', () => resolveOpen());
    ws.once('error', rejectOpen);
  });

  const sessionId = `bench-${Date.now().toString(36)}-${runIdx}`;
  const utteranceId = `utt-${path.basename(test.file, '.wav')}-${runIdx}-${Date.now().toString(36)}`;
  const base = {
    protocol_version: PROTOCOL_VERSION,
    session_id: sessionId,
    stream_id: 'stream-bench',
    source_id: 'mic-bench',
  };
  ws.send(JSON.stringify({ ...base, type: 'session.start', client: { platform: 'bench' }, audio: { codec: 'pcm_s16le', sample_rate_hz: 16000 } }));
  ws.send(JSON.stringify({ ...base, type: 'source.register', speaker_id: 'speaker-bench', language_hint: test.lang }));
  ws.send(JSON.stringify({ ...base, type: 'utterance.start', utterance_id: utteranceId, start_time_ms: 0, speaker_id: 'speaker-bench', language_hint: test.lang, vad: { engine: 'energy', speech_probability: 0.9, pre_roll_ms: 0 } }));

  // Realtime pacing: chunk i goes out at t0 + i*40ms (drift-corrected).
  const samplesPerChunk = 640;
  tSpeechStart = Date.now();
  let seq = 0;
  for (let off = 0; off < int16.length; off += samplesPerChunk) {
    const target = tSpeechStart + seq * 40;
    const wait = target - Date.now();
    if (wait > 0) await sleep(wait);
    const chunk = int16.subarray(off, Math.min(off + samplesPerChunk, int16.length));
    ws.send(encodeAudioFrame(
      {
        protocol_version: PROTOCOL_VERSION, type: 'audio.chunk',
        session_id: sessionId, stream_id: 'stream-bench', source_id: 'mic-bench',
        connection_id: 'conn-bench', participant_id: 'participant-bench',
        speaker_id: 'speaker-bench', speaker_state: 'speaking', utterance_id: utteranceId,
        sequence: seq, utterance_sequence: seq, capture_start_ms: seq * 40, duration_ms: 40,
        sent_at: new Date().toISOString(),
        audio: { codec: 'pcm_s16le', sample_rate_hz: 16000, channels: 1, payload_bytes: chunk.byteLength },
        speech: { vad_probability: 0.9, is_speech: true },
      } as never,
      chunk,
    ));
    seq++;
  }
  tEndSent = Date.now();
  ws.send(JSON.stringify({ ...base, type: 'utterance.end', utterance_id: utteranceId, reason: 'vad_silence', audio_duration_ms: Math.round(audioSec * 1000) }));

  await done;
  if (partialAsr.length > 0) {
    result.avgPartialAsrMs = Math.round(partialAsr.reduce((a, b) => a + b, 0) / partialAsr.length);
  }
  return result;
}

function fmt(v: number | null): string {
  return v === null ? '—' : `${Math.round(v)}`;
}

function stats(values: number[]): string {
  if (values.length === 0) return '—';
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return `median ${Math.round(median)} | min ${Math.round(sorted[0])} | max ${Math.round(sorted[sorted.length - 1])}`;
}

async function main() {
  console.log(`E2E benchmark — gateway ${GATEWAY_URL}, ${RUNS} run(s)/file, realtime pacing\n`);
  const all: RunResult[] = [];

  for (const test of TEST_SET) {
    for (let i = 0; i < RUNS; i++) {
      try {
        const r = await runOnce(test, i);
        all.push(r);
        console.log(
          `${r.file} [${r.lang}] run ${i + 1}: audio=${r.audioSec.toFixed(1)}s | ` +
          `firstPartial=${fmt(r.firstPartialMs)}ms (${r.partialCount} partials, avgASR=${fmt(r.avgPartialAsrMs)}ms) | ` +
          `final: +${fmt(r.finalGapMs)}ms (ASR ${fmt(r.finalAsrMs)}ms) | ` +
          `translation: +${fmt(r.translationGapMs)}ms (LLM ${fmt(r.translationModelMs)}ms) | ` +
          `STOP→XLAT=${fmt(r.stopToXlatMs)}ms`,
        );
      } catch (e) {
        console.error(`${test.file} run ${i + 1} FAILED: ${e}`);
      }
      await sleep(400);
    }
  }

  console.log('\n================ AGGREGATE ================');
  for (const test of TEST_SET) {
    const rows = all.filter((r) => r.file === path.basename(test.file));
    if (rows.length === 0) continue;
    const pick = (f: (r: RunResult) => number | null) =>
      rows.map(f).filter((v): v is number => v !== null);
    console.log(`\n${path.basename(test.file)} [${test.lang}] — ${rows.length} runs, audio ${rows[0].audioSec.toFixed(1)}s`);
    console.log(`  first partial (speech start → caption):   ${stats(pick((r) => r.firstPartialMs))} ms`);
    console.log(`  final STT     (utterance.end → final):    ${stats(pick((r) => r.finalGapMs))} ms`);
    console.log(`  translation   (final → translated):       ${stats(pick((r) => r.translationGapMs))} ms`);
    console.log(`  STOP → TRANSLATION (perceived*):          ${stats(pick((r) => r.stopToXlatMs))} ms`);
    console.log(`  sample final: "${rows[0].finalText.slice(0, 90)}"`);
    console.log(`  sample xlat:  "${rows[0].translatedText.slice(0, 90)}"`);
  }
  console.log('\n(*) Cộng thêm VAD end-silence ~480-1100ms (tiered) khi dùng mic thật.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
