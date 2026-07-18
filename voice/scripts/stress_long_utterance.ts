// Diagnostic: stream one LONG utterance (sample_en.wav repeated N times) through
// the gateway → STT WS path to observe behavior past the Whisper 30s window.
// Usage: npx tsx scripts/stress_long_utterance.ts [repeats=4]

import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';
import { encodeAudioFrame } from '../src/protocol/packetizer';
import { PROTOCOL_VERSION } from '../src/protocol/types';

const GATEWAY_URL = process.env.MOCK_GATEWAY_URL || 'ws://localhost:8081';
const REPEATS = Number.parseInt(process.argv[2] ?? '4', 10);
const WAV_PATH = path.resolve(process.cwd(), '../stt/tests/sample_en.wav');

const t0 = Date.now();
const el = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;

async function main() {
  const wavBuf = fs.readFileSync(WAV_PATH);
  const pcmOffset = wavBuf.subarray(0, 4).toString() === 'RIFF' ? 44 : 0;
  const single = wavBuf.subarray(pcmOffset);
  const pcmBuf = Buffer.concat(Array.from({ length: REPEATS }, () => single));
  const totalSamples = Math.floor(pcmBuf.length / 2);
  const int16 = new Int16Array(pcmBuf.buffer, pcmBuf.byteOffset, totalSamples);
  console.log(`Streaming ONE utterance of ${(totalSamples / 16000).toFixed(1)}s (${REPEATS}x sample_en.wav)`);

  const ws = new WebSocket(GATEWAY_URL);
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    const evt = JSON.parse(data.toString());
    if (evt.type === 'stt.partial') {
      console.log(`${el()} [partial ${evt.asr_latency_ms}ms] len=${(evt.text ?? '').length} "${(evt.text ?? '').slice(0, 80)}"`);
    } else if (evt.type === 'stt.final') {
      console.log(`${el()} [FINAL ${evt.asr_latency_ms}ms] len=${(evt.text ?? '').length}`);
      console.log(`  full text: "${evt.text}"`);
    } else if (evt.type === 'translation.final') {
      console.log(`${el()} [TRANSLATION ${evt.translation_latency_ms}ms] "${(evt.translated_text ?? '').slice(0, 120)}"`);
      ws.close();
      process.exit(0);
    }
  });

  ws.on('open', async () => {
    const sessionId = `stress-${Date.now().toString(36)}`;
    const utteranceId = `utt-stress-${Date.now().toString(36)}`;
    const base = {
      protocol_version: PROTOCOL_VERSION,
      session_id: sessionId,
      stream_id: 'stream-stress',
      source_id: 'mic-a-headset',
    };
    ws.send(JSON.stringify({ ...base, type: 'session.start', client: { platform: 'stress' }, audio: { codec: 'pcm_s16le', sample_rate_hz: 16000 } }));
    ws.send(JSON.stringify({ ...base, type: 'source.register', speaker_id: 'speaker-a', language_hint: 'en' }));
    // No delay on purpose: utterance.start races the gateway's STT socket
    // connect — the gateway must replay the turn once that socket opens.
    ws.send(JSON.stringify({ ...base, type: 'utterance.start', utterance_id: utteranceId, start_time_ms: 0, speaker_id: 'speaker-a', language_hint: 'en', vad: { engine: 'energy', speech_probability: 0.9, pre_roll_ms: 0 } }));

    const samplesPerChunk = 640; // 40ms
    let seq = 0;
    for (let off = 0; off < int16.length; off += samplesPerChunk) {
      const chunk = int16.subarray(off, Math.min(off + samplesPerChunk, int16.length));
      const frame = encodeAudioFrame(
        {
          protocol_version: PROTOCOL_VERSION,
          type: 'audio.chunk',
          session_id: sessionId,
          stream_id: 'stream-stress',
          source_id: 'mic-a-headset',
          connection_id: 'conn-stress',
          participant_id: 'participant-a',
          speaker_id: 'speaker-a',
          speaker_state: 'speaking',
          utterance_id: utteranceId,
          sequence: seq,
          utterance_sequence: seq,
          capture_start_ms: seq * 40,
          duration_ms: 40,
          sent_at: new Date().toISOString(),
          audio: { codec: 'pcm_s16le', sample_rate_hz: 16000, channels: 1, payload_bytes: chunk.byteLength },
          speech: { vad_probability: 0.9, is_speech: true },
        } as never,
        chunk,
      );
      ws.send(frame);
      seq++;
      // 4x realtime: still exercises the 1s partial cadence a few times
      if (seq % 4 === 0) await new Promise((r) => setTimeout(r, 40));
    }
    console.log(`${el()} sent ${seq} chunks, sending utterance.end`);
    ws.send(JSON.stringify({ ...base, type: 'utterance.end', utterance_id: utteranceId, reason: 'vad_silence', audio_duration_ms: (int16.length / 16) | 0 }));
  });

  setTimeout(() => {
    console.log(`${el()} TIMEOUT waiting for final/translation — giving up`);
    process.exit(1);
  }, 120_000);
}

main().catch((e) => { console.error(e); process.exit(1); });
