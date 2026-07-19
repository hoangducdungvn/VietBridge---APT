// Integration smoke for the REAL NestJS realtime path (socketio transport):
//   REST create/join → socket.io × 2 → turn.start → audio.chunk (WAV) → turn.end
//   → expect stt.partial/final + message.final (translated) on the GUEST socket.
// Requires: backend :3000 (STT_PROVIDER=remote) + stt service :8001 running.
// Usage: npx tsx scripts/smoke_nestjs_realtime.ts

import fs from 'fs';
import path from 'path';
import { io, type Socket } from 'socket.io-client';

const BASE = process.env.BACKEND_URL || 'http://localhost:3000';
const WAV = path.resolve(process.cwd(), '../stt/tests/sample_vi_neural.wav');

const t0 = Date.now();
const el = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;

async function rest(pathname: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${pathname} → HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()) as Record<string, unknown>;
}

function connect(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, {
      auth: { accessToken: token },
      transports: ['websocket'],
      reconnection: false,
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (e) => reject(new Error(`socket connect_error: ${e.message}`)));
  });
}

function once<T>(socket: Socket, event: string, timeoutMs = 30_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function main() {
  // 1. Lobby via REST
  const created = await rest('/api/sessions', { displayName: 'Host VI', sourceLanguage: 'vi' });
  const joined = await rest(`/api/sessions/${created.roomCode}/join`, { displayName: 'Guest EN', sourceLanguage: 'en' });
  console.log(`${el()} session ${created.sessionId} room ${created.roomCode}`);

  // 2. Realtime sockets
  const host = await connect(created.accessToken as string);
  const guest = await connect(joined.accessToken as string);
  console.log(`${el()} both sockets connected`);

  guest.on('stt.partial', (evt: { turnId: string; payload?: { text?: string } }) =>
    console.log(`${el()} [guest sees partial] "${(evt.payload?.text ?? '').slice(0, 70)}"`),
  );
  guest.on('pipeline.error', (evt: unknown) => console.log(`${el()} [pipeline.error]`, JSON.stringify(evt)));

  const sttFinalPromise = once<{ payload?: { text?: string; language?: string } }>(guest, 'stt.final');
  const messageFinalPromise = once<{ payload?: Record<string, unknown> }>(guest, 'message.final');

  // 3. Host speaks (streams the VI sample)
  host.emit('turn.start', {
    eventId: `event-smoke-start`,
    participantId: created.participantId,
    sessionId: created.sessionId,
    type: 'turn.start',
    payload: { audioConfig: { channels: 1, codec: 'pcm_s16le', sampleRate: 16_000 } },
  });
  const accepted = await once<{ turnId: string }>(host, 'turn.accepted');
  const turnId = accepted.turnId;
  console.log(`${el()} turn accepted ${turnId}`);

  const wav = fs.readFileSync(WAV);
  const pcm = wav.subarray(wav.subarray(0, 4).toString() === 'RIFF' ? 44 : 0);
  const chunkBytes = 1280; // 40ms of 16kHz mono s16le
  let seq = 0;
  for (let off = 0; off < pcm.length; off += chunkBytes) {
    host.emit('audio.chunk', {
      audio: pcm.subarray(off, Math.min(off + chunkBytes, pcm.length)),
      participantId: created.participantId,
      sequence: seq++,
      sessionId: created.sessionId,
      turnId,
    });
    // 4x realtime — enough to exercise buffering without a long wait
    if (seq % 4 === 0) await new Promise((r) => setTimeout(r, 40));
  }
  console.log(`${el()} streamed ${seq} chunks (${(pcm.length / 32000).toFixed(1)}s audio), sending turn.end`);
  host.emit('turn.end', {
    eventId: `event-smoke-end`,
    participantId: created.participantId,
    sessionId: created.sessionId,
    turnId,
    type: 'turn.end',
    payload: {},
  });

  // 4. Guest must receive the final transcript AND the translated message
  const sttFinal = await sttFinalPromise;
  console.log(`${el()} [guest stt.final] (${sttFinal.payload?.language}) "${sttFinal.payload?.text}"`);
  const messageFinal = await messageFinalPromise;
  const p = messageFinal.payload ?? {};
  console.log(`${el()} [guest message.final] ${p.sourceLanguage}→${p.targetLanguage}: "${p.translatedText}"`);
  console.log(`${el()} latency:`, JSON.stringify(p.latency));

  host.disconnect();
  guest.disconnect();
  console.log('\n✅ NestJS realtime path OK (REST → socket → STT remote → translation → message.final fan-out)');
  process.exit(0);
}

main().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
