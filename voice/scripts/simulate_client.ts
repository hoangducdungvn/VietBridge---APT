// Simulate client streaming audio.chunk binary frames to P4 Ingestion Gateway (ws://localhost:8081)
// and receiving live STT partial/final results from STT Service (http://localhost:8001).

import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';
import { encodeAudioFrame } from '../src/protocol/packetizer';
import { PROTOCOL_VERSION } from '../src/protocol/types';

const GATEWAY_URL = process.env.MOCK_GATEWAY_URL || 'ws://localhost:8081';
const WAV_PATH = fs.existsSync(path.resolve(process.cwd(), '../tests/sample_en.wav'))
  ? path.resolve(process.cwd(), '../tests/sample_en.wav')
  : path.resolve(process.cwd(), '../stt/tests/sample_en.wav');

function ts(): string {
  return new Date().toISOString();
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎧 VIETBRIDGE E2E LIVE STREAM DEMO: Client -> P4 Gateway -> STT Service');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (!fs.existsSync(WAV_PATH)) {
    console.error(`❌ WAV file not found: ${WAV_PATH}`);
    process.exit(1);
  }

  // Read raw PCM samples from WAV file (strip 44-byte header if present)
  const wavBuf = fs.readFileSync(WAV_PATH);
  let pcmOffset = 0;
  if (wavBuf.subarray(0, 4).toString() === 'RIFF' && wavBuf.subarray(8, 12).toString() === 'WAVE') {
    pcmOffset = 44;
  }
  const pcmBuf = wavBuf.subarray(pcmOffset);
  const totalSamples = Math.floor(pcmBuf.length / 2);
  const int16 = new Int16Array(pcmBuf.buffer, pcmBuf.byteOffset, totalSamples);

  const durationSec = (totalSamples / 16000).toFixed(1);
  console.log(`📂 Loaded sample_en.wav: ${durationSec}s (${totalSamples} samples @ 16kHz mono)`);

  const ws = new WebSocket(GATEWAY_URL);

  ws.on('open', async () => {
    console.log(`✅ Connected to P4 Ingestion Gateway: ${GATEWAY_URL}\n`);

    const sessionId = `meeting-${Date.now().toString(36)}`;
    const streamId = `stream-a-${Date.now().toString(36)}`;
    const sourceId = 'mic-a-headset';
    const utteranceId = `utt-demo-${Date.now().toString(36)}`;

    // 1. session.start
    ws.send(
      JSON.stringify({
        protocol_version: PROTOCOL_VERSION,
        type: 'session.start',
        event_id: `evt-start-${Date.now()}`,
        session_id: sessionId,
        stream_id: streamId,
        source_id: sourceId,
        sent_at: ts(),
        client: { platform: 'web', app_version: '1.0.0', device_id: 'demo-pc' },
        audio: { codec: 'pcm_s16le', sample_rate_hz: 16000, channels: 1, chunk_duration_ms: 40 },
      })
    );

    await sleep(100);

    // 2. source.register
    ws.send(
      JSON.stringify({
        protocol_version: PROTOCOL_VERSION,
        type: 'source.register',
        event_id: `evt-reg-${Date.now()}`,
        session_id: sessionId,
        stream_id: streamId,
        source_id: sourceId,
        sent_at: ts(),
        participant_id: 'participant-a',
        speaker_id: 'speaker-a',
        language_hint: 'en',
      })
    );

    await sleep(100);

    // 3. utterance.start
    console.log(`🎙️  Starting utterance [id: ${utteranceId}, lang_hint: en]...`);
    ws.send(
      JSON.stringify({
        protocol_version: PROTOCOL_VERSION,
        type: 'utterance.start',
        event_id: `evt-utt-start-${Date.now()}`,
        session_id: sessionId,
        stream_id: streamId,
        source_id: sourceId,
        sent_at: ts(),
        utterance_id: utteranceId,
        participant_id: 'participant-a',
        speaker_id: 'speaker-a',
        language_hint: 'en',
        start_time_ms: 0,
        vad: { engine: 'silero', speech_probability: 0.96, pre_roll_ms: 250 },
      })
    );

    // 4. Stream 40ms chunks (640 samples per chunk)
    const chunkSize = 640;
    const chunkDurMs = 40;
    let sequence = 1;
    const totalChunks = Math.ceil(totalSamples / chunkSize);

    console.log(`🚀 Streaming ${totalChunks} binary audio.chunk frames (~40ms each)...`);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, totalSamples);
      const chunkSamples = int16.subarray(start, end);

      const metadata = {
        protocol_version: PROTOCOL_VERSION,
        type: 'audio.chunk' as const,
        session_id: sessionId,
        stream_id: streamId,
        connection_id: 'conn-demo',
        source_id: sourceId,
        participant_id: 'participant-a',
        speaker_id: 'speaker-a',
        utterance_id: utteranceId,
        sequence: sequence++,
        utterance_sequence: i + 1,
        capture_start_ms: i * chunkDurMs,
        duration_ms: chunkDurMs,
        audio: {
          codec: 'pcm_s16le',
          sample_rate_hz: 16000,
          channels: 1,
          payload_bytes: chunkSamples.byteLength,
        },
        speech: { vad_probability: 0.95, overlap: false, active_speaker_ids: ['speaker-a'] },
        processing: {
          aec_applied: true,
          noise_suppression_applied: true,
          agc_applied: true,
          resampled: false,
        },
        quality: { rms_dbfs: -20, peak_dbfs: -5, estimated_snr_db: 20, clipping_ratio: 0 },
      };

      const binaryFrame = encodeAudioFrame(metadata, chunkSamples);
      ws.send(binaryFrame);

      // Simulate live network pacing slightly (e.g. 30ms sleep per 40ms frame)
      // to let periodic re-decode trigger naturally!
      await sleep(35);
    }

    await sleep(200);

    // 5. utterance.end
    console.log(`🛑 Sending utterance.end...`);
    ws.send(
      JSON.stringify({
        protocol_version: PROTOCOL_VERSION,
        type: 'utterance.end',
        event_id: `evt-utt-end-${Date.now()}`,
        session_id: sessionId,
        stream_id: streamId,
        source_id: sourceId,
        sent_at: ts(),
        utterance_id: utteranceId,
        speaker_id: 'speaker-a',
        end_time_ms: Math.floor((totalSamples / 16000) * 1000),
        last_sequence: sequence - 1,
        reason: 'vad_silence',
        audio_duration_ms: Math.floor((totalSamples / 16000) * 1000),
        quality_summary: { average_snr_db: 20, clipping_ratio: 0, dropped_chunks: 0 },
      })
    );

    // Wait a couple seconds for final result before exiting
    await sleep(3000);
    ws.close();
    console.log('\n✨ Demo completed successfully!');
    process.exit(0);
  });

  ws.on('message', (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'stt.partial') {
        console.log(`\n🎉 [CLIENT EVENT: stt.partial] (${msg.backend} | ${msg.asr_latency_ms}ms) -> "${msg.text}"`);
      } else if (msg.type === 'stt.final') {
        console.log(`\n🏆 [CLIENT EVENT: stt.final]   (${msg.backend} | ${msg.asr_latency_ms}ms) -> "${msg.text}"\n`);
      } else if (msg.type === 'stream.ack') {
        console.log(`📦 [CLIENT EVENT: stream.ack]    (highest sequence: ${msg.highest_contiguous_sequence})`);
      }
    } catch {
      // Ignore non-json or binary
    }
  });

  ws.on('error', (err) => {
    console.error(`❌ WebSocket error: ${err.message}`);
  });
}

main().catch(console.error);
