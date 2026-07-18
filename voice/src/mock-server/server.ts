// Mock ingestion gateway implementing docs/audio-streaming-contract.md v1.3
// Run with: npm run mock-server (uses tsx watch)

import { WebSocketServer, WebSocket } from 'ws';
import { decodeAudioFrame } from '../protocol/packetizer';
import { PROTOCOL_VERSION } from '../protocol/types';
// Translation tầng riêng: translation/ ở root repo (cùng cấp voice/, stt/, backend/)
import { translate, normalizeLang, TranslationError } from '../../../translation/src/translator';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env from project root
// server.ts lives at: voice/src/mock-server/server.ts
// project root  is at: ../../.. (3 levels up)
try {
  const __dir = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(__dir, '..', '..', '..', '.env'); // voice/src/mock-server → voice/src → voice → project root
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    const val = rest.join('=').trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) process.env[key.trim()] = val;
  }
  console.log('[ENV] Loaded .env from', envPath);
} catch {
  console.warn('[ENV] .env not found — relying on shell env vars');
}


const DEFAULT_PORT = 8081;
const configuredPort = Number.parseInt(process.env.MOCK_GATEWAY_PORT ?? '', 10);
const PORT =
  Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65_535
    ? configuredPort
    : DEFAULT_PORT;

// ??20.3 D16: partial STT cadence. Default 1000ms; tunable via PARTIAL_CADENCE_MS env.
// README STT recommends 2000ms, p95 latency 2.9s. inFlightPartial gate prevents pile-up.
const PARTIAL_CADENCE_MS = (() => {
  const v = Number.parseInt(process.env.PARTIAL_CADENCE_MS ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 1000;
})();

// ---------------------------------------------------------------------------
// Session registry ??? maps sessionId ??? set of active WebSocket connections.
// All members of a session receive broadcast results (fan-out).
// ---------------------------------------------------------------------------
const sessionRegistry = new Map<string, Set<WebSocket>>();

function registerSession(sessionId: string, ws: WebSocket): void {
  if (!sessionId) return;
  let members = sessionRegistry.get(sessionId);
  if (!members) {
    members = new Set();
    sessionRegistry.set(sessionId, members);
  }
  members.add(ws);
  log('[SESSION]', C.cyan, sessionId, `registered ??? members now ${members.size}`);
}

function deregisterSession(sessionId: string, ws: WebSocket): void {
  const members = sessionRegistry.get(sessionId);
  if (!members) return;
  members.delete(ws);
  log('[SESSION]', C.dim, sessionId, `deregistered ??? members now ${members.size}`);
  if (members.size === 0) sessionRegistry.delete(sessionId);
}

/**
 * Send payload to every open WS in the session.
 * Falls back to sending only to `fallback` when sessionId is absent.
 */
function broadcastToSession(
  sessionId: string,
  fallback: WebSocket,
  payload: Record<string, unknown>,
): void {
  const members = sessionId ? sessionRegistry.get(sessionId) : undefined;
  if (!members || members.size === 0) {
    // No registry entry yet (session.start not received) ??? echo back to sender only.
    send(fallback, payload);
    return;
  }
  const json = JSON.stringify(payload);
  let sent = 0;
  for (const ws of members) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(json);
      sent++;
    }
  }
  log('[BROADCAST]', `${C.dim}${C.green}`, sessionId, `??? ${payload.type as string} ?? ${sent} clients`);
}


// ---------------------------------------------------------------------------
// ANSI color helpers
// ---------------------------------------------------------------------------
const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  red:     '\x1b[31m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  magenta: '\x1b[35m',
  cyan:    '\x1b[36m',
  white:   '\x1b[37m',
  bgGreen: '\x1b[42m',
  bgBlue:  '\x1b[44m',
  bgRed:   '\x1b[41m',
} as const;

function ts(): string {
  return new Date().toISOString();
}

function log(prefix: string, color: string, sourceId: string, msg: string): void {
  const time = `${C.dim}${ts()}${C.reset}`;
  const src = sourceId ? ` ${C.cyan}${sourceId}${C.reset}` : '';
  console.log(`${time} ${color}${prefix}${C.reset}${src} ${msg}`);
}

// ---------------------------------------------------------------------------
// UUID helper
// ---------------------------------------------------------------------------
function uuid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Fallback for older Node versions
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

// ---------------------------------------------------------------------------
// Per-connection session state
// ---------------------------------------------------------------------------
interface ActiveUtterance {
  id: string;
  /** Full utterance audio. The live copy streams to the STT WS as it arrives;
   *  this buffer is the authoritative replay source when the STT socket was
   *  not yet open at utterance.start or dropped mid-turn (Python loses its
   *  buffer on disconnect, so a reconnect must resend start_turn + audio). */
  pcmChunks: Int16Array[];
  langHint: string;
  lastPartialMs: number;
  /** A partial STT request is currently in flight — skip new partial ticks
   *  so slow responses (p95 ~3s > 1s cadence) never pile up out of order. */
  inFlightPartial: boolean;
  /** The final STT result has been sent — drop any late partial responses. */
  finalized: boolean;
}

interface SessionState {
  sessionId: string;
  streamId: string;
  sourceId: string;
  speakerId: string | null;
  highestSequence: number;
  totalChunks: number;
  totalAudioDurationMs: number;
  utteranceCount: number;
  serverReceivedTimestamps: number[];    // D7 §10.4 overlap detection
  connectedAt: number;
  activeUtterance: ActiveUtterance | null;
  translationContext: { sourceText: string; translatedText: string }[];
  sttWs: WebSocket | null;
  /** utterance.end arrived while the STT socket was down — replay start_turn +
   *  audio + finish_turn once it reconnects so the final is not lost. */
  pendingFinal: ActiveUtterance | null;
  sttBackoffMs: number;
  clientClosed: boolean;
}

function createSessionState(): SessionState {
  return {
    sessionId: '',
    streamId: '',
    sourceId: '',
    speakerId: null,
    highestSequence: -1,
    totalChunks: 0,
    totalAudioDurationMs: 0,
    utteranceCount: 0,
    serverReceivedTimestamps: [],
    connectedAt: Date.now(),
    activeUtterance: null,
    translationContext: [],
    sttWs: null,
    pendingFinal: null,
    sttBackoffMs: 500,
    clientClosed: false,
  };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ port: PORT });

wss.on('listening', () => {
  console.log('');
  console.log(`${C.bgGreen}${C.bold}${C.white} VIETBRIDGE MOCK INGESTION GATEWAY ${C.reset}`);
  console.log(`${C.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
  console.log(`  ${C.bold}Port:${C.reset}     ${C.yellow}${PORT}${C.reset}`);
  console.log(`  ${C.bold}Protocol:${C.reset} ${C.yellow}v${PROTOCOL_VERSION}${C.reset}`);
  console.log(`  ${C.bold}URL:${C.reset}      ${C.cyan}ws://localhost:${PORT}${C.reset}`);
  console.log(`${C.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
  console.log(`  ${C.dim}Waiting for connections…${C.reset}`);
  console.log('');
});

wss.on('connection', (ws: WebSocket) => {
  const state = createSessionState();

  log('[CONNECT]', `${C.bgBlue}${C.bold}${C.white}`, '', 'New client connected');

  // Establish persistent connection to STT WS backend (auto-reconnect + replay)
  connectSttWs(ws, state);

  // ------------------------------------------------------------------
  // Text frames → control events
  // ------------------------------------------------------------------
  ws.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
    if (isBinary) {
      handleBinaryFrame(ws, state, toArrayBuffer(data));
      return;
    }
    handleTextFrame(ws, state, data.toString());
  });

  ws.on('close', () => {
    state.clientClosed = true; // stop the STT reconnect loop
    // Deregister from session registry
    if (state.sessionId) deregisterSession(state.sessionId, ws);
    if (state.sttWs && state.sttWs.readyState === WebSocket.OPEN) {
      state.sttWs.close();
    }

    const elapsed = ((Date.now() - state.connectedAt) / 1000).toFixed(1);
    log(
      '[DISCONNECT]',
      `${C.bgRed}${C.bold}${C.white}`,
      state.sourceId,
      `Client disconnected — session summary: ` +
        `${C.bold}${state.totalChunks}${C.reset} chunks, ` +
        `${C.bold}${(state.totalAudioDurationMs / 1000).toFixed(1)}s${C.reset} audio, ` +
        `${C.bold}${state.utteranceCount}${C.reset} utterances, ` +
        `${C.bold}${elapsed}s${C.reset} connected`,
    );
  });

  ws.on('error', (err: Error) => {
    log('[ERROR]', C.red, state.sourceId, err.message);
  });
});


// ---------------------------------------------------------------------------
// Buffer normalisation (ws may deliver Buffer, ArrayBuffer, or Buffer[])
// ---------------------------------------------------------------------------
function toArrayBuffer(data: Buffer | ArrayBuffer | Buffer[]): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

// ---------------------------------------------------------------------------
// STT WebSocket bridge — persistent per-client socket with reconnect + replay.
//
// The Python side keeps the audio buffer only in socket-local state: any drop
// (or a start_turn sent before the socket was OPEN) loses the whole turn. So
// on every (re)open we replay the authoritative turn state from pcmChunks
// instead of trusting whatever happened to get through earlier.
// ---------------------------------------------------------------------------
const STT_WS_URL = process.env.STT_WS_URL || 'ws://localhost:8001/ws';

function sttStartTurnPayload(utt: ActiveUtterance): string {
  return JSON.stringify({
    type: 'start_turn',
    turnId: utt.id,
    language: utt.langHint,
    cadence_ms: PARTIAL_CADENCE_MS,
  });
}

function connectSttWs(clientWs: WebSocket, state: SessionState): void {
  const sock = new WebSocket(STT_WS_URL);
  state.sttWs = sock;

  sock.on('open', () => {
    if (state.sttWs !== sock) return;
    state.sttBackoffMs = 500;
    log('[STT]', C.green, state.sourceId, 'Connected to STT WebSocket');

    if (state.pendingFinal) {
      // utterance.end arrived while STT was down — replay the whole turn.
      const utt = state.pendingFinal;
      state.pendingFinal = null;
      sock.send(sttStartTurnPayload(utt));
      for (const chunk of utt.pcmChunks) sock.send(chunk);
      sock.send(JSON.stringify({ type: 'finish_turn', turnId: utt.id }));
      log('[STT]', C.yellow, state.sourceId, `replayed finished turn ${utt.id} (${utt.pcmChunks.length} chunks)`);
    } else if (state.activeUtterance) {
      // Turn opened before the socket was ready (or mid-turn reconnect).
      const utt = state.activeUtterance;
      sock.send(sttStartTurnPayload(utt));
      for (const chunk of utt.pcmChunks) sock.send(chunk);
      if (utt.pcmChunks.length > 0) {
        log('[STT]', C.yellow, state.sourceId, `replayed active turn ${utt.id} (${utt.pcmChunks.length} chunks)`);
      }
    }
  });

  sock.on('message', (data: Buffer) => {
    if (state.sttWs !== sock) return;
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'stt.partial' || msg.type === 'stt.final') {
        const isFinal = msg.type === 'stt.final';
        const tag = isFinal ? 'FINAL' : 'PARTIAL';
        const color = isFinal ? `${C.bgGreen}${C.bold}${C.white}` : `${C.green}${C.bold}`;
        const text = msg.text || '';

        log(
          `[STT ${tag}]`,
          color,
          state.sourceId,
          `[backend=${msg.backend} | ${msg.asr_latency_ms}ms] utt=${C.yellow}${msg.turnId}${C.reset} "${text}"`,
        );

        broadcastToSession(state.sessionId, clientWs, {
          protocol_version: PROTOCOL_VERSION,
          type: msg.type,
          session_id: state.sessionId,
          stream_id: state.streamId,
          source_id: state.sourceId,
          speaker_id: state.speakerId,
          utterance_id: msg.turnId,
          text: text,
          language: msg.language,
          backend: msg.backend,
          asr_latency_ms: msg.asr_latency_ms,
          low_confidence: msg.low_confidence ?? false,
          eou: msg.eou ?? null,
          server_time: ts(),
        });

        if (isFinal && text.trim().length > 0) {
          callTranslationService(clientWs, state, msg.turnId, text, msg.language).catch(() => undefined);
        }
      } else if (msg.type === 'stt.error') {
        log('[STT ERROR]', C.red, state.sourceId, msg.error || 'Unknown STT WS Error');
        // Surface the failure so the UI can drop its stuck live-partial state.
        broadcastToSession(state.sessionId, clientWs, {
          protocol_version: PROTOCOL_VERSION,
          type: 'stt.error',
          session_id: state.sessionId,
          source_id: state.sourceId,
          utterance_id: msg.turnId ?? null,
          message: msg.error ?? 'stt_error',
          server_time: ts(),
        });
      }
    } catch (e) {
      log('[STT ERROR]', C.red, state.sourceId, `Failed to parse STT WS message: ${e}`);
    }
  });

  sock.on('error', (err: Error) => {
    if (state.sttWs !== sock) return;
    log('[STT ERROR]', C.red, state.sourceId, `STT WS Connection error: ${err.message}`);
  });

  sock.on('close', () => {
    if (state.sttWs !== sock) return;
    log('[STT]', C.dim, state.sourceId, 'STT WS Connection closed');
    if (state.clientClosed) return;
    const delay = state.sttBackoffMs;
    state.sttBackoffMs = Math.min(state.sttBackoffMs * 2, 5000);
    log('[STT]', C.yellow, state.sourceId, `Reconnecting to STT WebSocket in ${delay}ms…`);
    setTimeout(() => {
      if (!state.clientClosed && state.sttWs === sock) connectSttWs(clientWs, state);
    }, delay);
  });
}

// ---------------------------------------------------------------------------
// Control event handler
// ---------------------------------------------------------------------------
function handleTextFrame(ws: WebSocket, state: SessionState, raw: string): void {
  let evt: Record<string, unknown>;
  try {
    evt = JSON.parse(raw);
  } catch {
    log('[WARN]', C.yellow, state.sourceId, `Unparseable text frame: ${raw.slice(0, 120)}`);
    return;
  }

  const type = evt.type as string;

  switch (type) {
    // ------------------------------------------------------------------ session.start
    case 'session.start': {
      state.sessionId = evt.session_id as string;
      state.streamId = evt.stream_id as string;
      state.sourceId = evt.source_id as string;
      const client = evt.client as Record<string, unknown> | undefined;
      const platform = client?.platform ?? '?';
      const audio = evt.audio as Record<string, unknown> | undefined;
      const codec = audio?.codec ?? '?';
      const sampleRate = audio?.sample_rate_hz ?? '?';

      // Register this connection into the session fan-out registry
      registerSession(state.sessionId, ws);

      log(
        '[EVENT]',
        `${C.green}${C.bold}`,
        state.sourceId,
        `session.start — session=${C.yellow}${state.sessionId}${C.reset} ` +
          `platform=${platform} codec=${codec} sample_rate=${sampleRate}`,
      );

      send(ws, {
        protocol_version: PROTOCOL_VERSION,
        type: 'session.accepted',
        session_id: state.sessionId,
        server_time: ts(),
      });
      break;
    }

    // ------------------------------------------------------------------ source.register
    case 'source.register': {
      state.sourceId = evt.source_id as string;
      state.speakerId = (evt.speaker_id as string) ?? null;
      const langHint = evt.language_hint as string;
      const mic = evt.microphone as Record<string, unknown> | undefined;

      log(
        '[EVENT]',
        `${C.green}${C.bold}`,
        state.sourceId,
        `source.register — speaker=${C.magenta}${state.speakerId ?? 'null'}${C.reset} ` +
          `lang=${langHint} mic=${mic?.label ?? '?'}`,
      );

      send(ws, {
        protocol_version: PROTOCOL_VERSION,
        type: 'source.accepted',
        session_id: state.sessionId,
        source_id: state.sourceId,
        server_time: ts(),
      });
      break;
    }

    // ------------------------------------------------------------------ utterance.start
    case 'utterance.start': {
      state.utteranceCount++;
      state.serverReceivedTimestamps.push(Date.now());
      const uttId = evt.utterance_id as string;
      const startMs = evt.start_time_ms as number;
      const speaker = evt.speaker_id as string | null;
      const vad = evt.vad as Record<string, unknown> | undefined;

      // normalizeLang: 2-mic MVP has static per-source hints; "auto" is not a
      // valid runtime value (fpt_final would silently TRANSLATE instead of
      // transcribe without a concrete language) — anything not 'en' becomes 'vi'.
      state.activeUtterance = {
        id: uttId,
        pcmChunks: [],
        langHint: normalizeLang(evt.language_hint as string),
        lastPartialMs: Date.now(),
        inFlightPartial: false,
        finalized: false,
      };

      log(
        '[EVENT]',
        `${C.magenta}${C.bold}`,
        state.sourceId,
        `utterance.start — id=${C.yellow}${uttId}${C.reset} ` +
          `start=${startMs}ms speaker=${speaker ?? 'null'} ` +
          `vad_engine=${vad?.engine ?? '?'} speech_prob=${vad?.speech_probability ?? '?'} ` +
          `pre_roll=${vad?.pre_roll_ms ?? 0}ms`,
      );
      
      // Send start_turn to STT service. If the socket is not OPEN yet the turn
      // is NOT lost: connectSttWs replays it (start_turn + buffered audio).
      if (state.sttWs && state.sttWs.readyState === WebSocket.OPEN) {
        state.sttWs.send(sttStartTurnPayload(state.activeUtterance));
      }
      break;
    }

    // ------------------------------------------------------------------ utterance.end
    case 'utterance.end': {
      state.serverReceivedTimestamps.push(Date.now());
      const uttId = evt.utterance_id as string;
      const reason = evt.reason as string;
      const audioDur = evt.audio_duration_ms as number;
      const quality = evt.quality_summary as Record<string, unknown> | undefined;

      log(
        '[EVENT]',
        `${C.magenta}${C.bold}`,
        state.sourceId,
        `utterance.end   — id=${C.yellow}${uttId}${C.reset} ` +
          `reason=${reason} duration=${audioDur}ms ` +
          `snr=${quality?.average_snr_db ?? '?'}dB ` +
          `clipping=${quality?.clipping_ratio ?? '?'} ` +
          `dropped=${quality?.dropped_chunks ?? 0}`,
      );

      if (state.activeUtterance && state.activeUtterance.id === uttId) {
        const utt = state.activeUtterance;
        state.activeUtterance = null;
        if (state.sttWs && state.sttWs.readyState === WebSocket.OPEN) {
          state.sttWs.send(JSON.stringify({ type: 'finish_turn', turnId: uttId }));
        } else {
          // STT is down right now — replay start+audio+finish on reconnect.
          state.pendingFinal = utt;
        }
      }

      // D3: ACK once after utterance.end, not periodic
      send(ws, {
        protocol_version: PROTOCOL_VERSION,
        type: 'stream.ack',
        session_id: state.sessionId,
        stream_id: state.streamId,
        highest_contiguous_sequence: state.highestSequence,
        missing_sequences: [],
        server_time: ts(),
      });
      break;
    }

    // ------------------------------------------------------------------ heartbeat.ping
    case 'heartbeat.ping': {
      const pingEventId = evt.event_id as string;
      state.streamId = (evt.stream_id as string) || state.streamId;

      log('[EVENT]', `${C.blue}${C.bold}`, state.sourceId, `heartbeat.ping — event_id=${pingEventId}`);

      send(ws, {
        protocol_version: PROTOCOL_VERSION,
        type: 'heartbeat.pong',
        event_id: uuid(),
        session_id: state.sessionId,
        stream_id: state.streamId,
        in_reply_to: pingEventId,
        server_time: ts(),
      });
      break;
    }

    // ------------------------------------------------------------------ stream.resume
    case 'stream.resume': {
      state.sessionId = (evt.session_id as string) || state.sessionId;
      state.streamId = (evt.stream_id as string) || state.streamId;
      state.sourceId = (evt.source_id as string) || state.sourceId;
      const connId = evt.connection_id as string;
      const lastAck = evt.last_acknowledged_sequence as number;
      const nextSeq = evt.next_sequence as number;

      log(
        '[EVENT]',
        `${C.yellow}${C.bold}`,
        state.sourceId,
        `stream.resume — conn=${connId} last_ack=${lastAck} next=${nextSeq}`,
      );

      send(ws, {
        protocol_version: PROTOCOL_VERSION,
        type: 'source.accepted',
        session_id: state.sessionId,
        source_id: state.sourceId,
        server_time: ts(),
      });
      break;
    }

    // ------------------------------------------------------------------ session.end
    case 'session.end': {
      log(
        '[EVENT]',
        `${C.red}${C.bold}`,
        state.sourceId,
        `session.end — ` +
          `total_chunks=${C.bold}${state.totalChunks}${C.reset} ` +
          `total_audio=${C.bold}${(state.totalAudioDurationMs / 1000).toFixed(1)}s${C.reset} ` +
          `utterances=${C.bold}${state.utteranceCount}${C.reset}`,
      );
      break;
    }

    // ------------------------------------------------------------------ unknown
    default:
      log('[WARN]', C.yellow, state.sourceId, `Unhandled event type: ${type}`);
  }
}

// ---------------------------------------------------------------------------
// Binary frame handler (audio.chunk)
// ---------------------------------------------------------------------------
function handleBinaryFrame(_ws: WebSocket, state: SessionState, buffer: ArrayBuffer): void {
  const { metadata, payload: _payload } = decodeAudioFrame(buffer);

  // Update tracking
  const seq = metadata.sequence;
  if (seq > state.highestSequence) {
    state.highestSequence = seq;
  }
  state.totalChunks++;
  state.totalAudioDurationMs += metadata.duration_ms;
  state.serverReceivedTimestamps.push(Date.now());

  // Update source info from audio metadata
  state.sourceId = metadata.source_id || state.sourceId;
  state.speakerId = metadata.speaker_id ?? state.speakerId;
  state.streamId = metadata.stream_id || state.streamId;
  state.sessionId = metadata.session_id || state.sessionId;

  // Log every 25th chunk to avoid flooding the console
  if (state.totalChunks % 25 === 0 || state.totalChunks === 1) {
    log(
      '[AUDIO]',
      `${C.cyan}${C.bold}`,
      state.sourceId,
      `chunk #${C.yellow}${seq}${C.reset} from ${C.magenta}${metadata.speaker_id ?? 'null'}${C.reset} ` +
        `(${metadata.duration_ms}ms, ${metadata.audio.payload_bytes}B, ` +
        `vad=${metadata.speech.vad_probability.toFixed(2)}, ` +
        `capture=${metadata.capture_start_ms}ms)`,
    );
  }

  // Add payload to current utterance if active and stream to WS
  if (state.activeUtterance) {
    const payloadView = new Int16Array(_payload);
    state.activeUtterance.pcmChunks.push(payloadView);
    
    if (state.sttWs && state.sttWs.readyState === WebSocket.OPEN) {
      state.sttWs.send(_payload);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function send(ws: WebSocket, payload: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    const json = JSON.stringify(payload);
    ws.send(json);
    log('[REPLY]', `${C.dim}${C.green}`, '', `→ ${payload.type as string}`);
  }
}

// ---------------------------------------------------------------------------
// Translation — logic lives in src/translation/translator.ts; this wrapper
// only adds gateway concerns (logging + emitting translation.final).
// ---------------------------------------------------------------------------
async function callTranslationService(
  ws: WebSocket,
  state: SessionState,
  utteranceId: string,
  sourceText: string,
  langHint: string,
): Promise<void> {
  try {
    const res = await translate(sourceText, langHint, { context: state.translationContext });

    // Append to conversation context for LLM coherence, keeping the window small (e.g., last 4 turns)
    state.translationContext.push({ sourceText, translatedText: res.translatedText });
    if (state.translationContext.length > 4) {
      state.translationContext.shift();
    }

    log(
      '[TRANSLATION]',
      `${C.magenta}${C.bold}`,
      state.sourceId,
      `[${res.model} | ${res.latencyMs}ms] "${res.translatedText}"`,
    );

    broadcastToSession(state.sessionId, ws, {
      protocol_version: PROTOCOL_VERSION,
      type: 'translation.final',
      session_id: state.sessionId,
      stream_id: state.streamId,
      source_id: state.sourceId,
      speaker_id: state.speakerId,
      utterance_id: utteranceId,
      source_text: sourceText,
      translated_text: res.translatedText,
      source_lang: res.sourceLang,
      target_lang: res.targetLang,
      model: res.model,
      translation_latency_ms: res.latencyMs,
      server_time: ts(),
    });
  } catch (err: unknown) {
    const detail =
      err instanceof TranslationError
        ? `${err.message}${err.status ? ` (HTTP ${err.status})` : ''}`
        : String(err);
    log('[TRANSLATION ERROR]', C.red, state.sourceId, detail);
  }
}
