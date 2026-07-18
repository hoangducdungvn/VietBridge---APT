// Browser WebSocket client implementing docs/audio-streaming-contract.md v1.3:
// session/source lifecycle, binary audio.chunk framing, heartbeat ping/pong
// (D21), sequence tracking with a resend ring buffer, and reconnect /
// backpressure handling (D19/D20).
//
// D12: on stream.resume, this client also resends the most recent
// utterance.start (if the utterance is still open) and/or the most recent
// utterance.end (if it was sent just before the disconnect), not just
// audio.chunk frames. Without this, a dropped connection right after
// utterance.start could leave the gateway with audio.chunk frames for an
// utterance it never saw opened.

import { v4 as uuidv4 } from 'uuid';
import { encodeAudioFrame } from './packetizer';
import {
  PROTOCOL_VERSION,
  type AudioChunkMetadata,
  type ErrorEvent,
  type StreamAckEvent,
  type StreamResumeEvent,
  type StreamThrottleEvent,
  type UtteranceEndEvent,
  type UtteranceStartEvent,
} from './types';

export interface VoiceStreamClientConfig {
  url: string;
  sessionId: string;
  streamId: string;
  sourceId: string;
  participantId: string;
  speakerId: string | null;
  languageHint: 'vi' | 'en' | 'auto';
  deviceId: string;
  appVersion?: string;
  /** How long (ms) to keep unacked audio.chunk frames for resend. Default 5s (D4). */
  resendBufferMs?: number;
  /** Default 15s (D21) — same value for every environment, no LAN/Wi-Fi tuning. */
  heartbeatIntervalMs?: number;
  /** Default 5s (D21). */
  heartbeatTimeoutMs?: number;
}

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'throttled' | 'reconnecting' | 'closed';

export interface SttResultEvent {
  type: 'partial' | 'final';
  text: string;
  language: string;
  backend: string;
  latencyMs: number;
  utteranceId: string;
  lowConfidence?: boolean;
  /** Attribution — gateway fan-outs results of BOTH speakers to every client
   *  in the session; use these to route the bubble to the right pane. */
  sourceId?: string;
  speakerId?: string | null;
}

export interface TranslationResultEvent {
  utteranceId: string;
  sourceText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  model: string;
  latencyMs: number;
  /** Attribution — see SttResultEvent. */
  sourceId?: string;
  speakerId?: string | null;
}

export interface SttErrorEvent {
  utteranceId: string | null;
  message: string;
}

export interface VoiceStreamClientEvents {
  onStateChange?(state: ConnectionState): void;
  onLog?(message: string): void;
  onServerAck?(ack: StreamAckEvent): void;
  onThrottle?(evt: StreamThrottleEvent): void;
  onBackpressure?(evt: ErrorEvent): void;
  onSttResult?(result: SttResultEvent): void;
  onTranslationResult?(result: TranslationResultEvent): void;
  /** STT backend failed mid-utterance — no stt.final will follow; the UI
   *  should drop any stuck live-partial for that utterance. */
  onSttError?(evt: SttErrorEvent): void;
}

type EnvelopeKeys = 'protocol_version' | 'type' | 'event_id' | 'session_id' | 'stream_id' | 'source_id' | 'sent_at';

export type UtteranceStartPartial = Omit<UtteranceStartEvent, EnvelopeKeys>;
export type UtteranceEndPartial = Omit<UtteranceEndEvent, EnvelopeKeys>;
export type AudioChunkPartial = Omit<
  AudioChunkMetadata,
  'protocol_version' | 'type' | 'session_id' | 'stream_id' | 'source_id' | 'connection_id' | 'sequence'
>;

interface BufferedAudioFrame {
  sequence: number;
  frame: ArrayBuffer;
  enqueuedAt: number;
}

const DEFAULT_RESEND_BUFFER_MS = 5000; // D4
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15000; // D21
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 5000; // D21
/** How long after sending utterance.end we still consider it worth resending on reconnect (D12). */
const UTTERANCE_END_RESEND_WINDOW_MS = 5000;

export class VoiceStreamClient {
  private ws: WebSocket | null = null;
  private connectionId = uuidv4();
  private sequence = 0;
  private highestAcked = -1;
  private resendBuffer: BufferedAudioFrame[] = [];

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatWatchdog: ReturnType<typeof setTimeout> | null = null;
  private lastActivityAt = Date.now();
  private missedPongs = 0;

  private state: ConnectionState = 'idle';
  private closedByUser = false;

  // D12 bookkeeping: last control events, resent verbatim (same event_id) on stream.resume.
  private utteranceActive = false;
  private lastUtteranceStart: UtteranceStartEvent | null = null;
  private lastUtteranceEnd: UtteranceEndEvent | null = null;
  private lastUtteranceEndAt = 0;

  constructor(
    private readonly config: VoiceStreamClientConfig,
    private readonly events: VoiceStreamClientEvents = {}
  ) {}

  getState(): ConnectionState {
    return this.state;
  }

  getCurrentSequence(): number {
    return this.sequence;
  }

  async connect(resume = false): Promise<void> {
    this.closedByUser = false;
    this.setState(resume ? 'reconnecting' : 'connecting');
    this.connectionId = uuidv4();

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.config.url);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      let settled = false;

      const connectTimeout = setTimeout(() => {
        if (!settled && ws.readyState === WebSocket.CONNECTING) {
          settled = true;
          reject(new Error('WebSocket connection timed out'));
        }
      }, 8000);

      ws.onopen = () => {
        clearTimeout(connectTimeout);
        this.setState('connected');
        this.missedPongs = 0;
        this.startHeartbeat();

        if (resume) {
          this.sendControlEvent('stream.resume', {
            connection_id: this.connectionId,
            last_acknowledged_sequence: this.highestAcked,
            next_sequence: this.sequence,
          } satisfies Omit<StreamResumeEvent, EnvelopeKeys>);
          this.resendControlCheckpoint();
          this.flushResendBuffer();
        } else {
          this.sendControlEvent('session.start', {
            client: {
              platform: 'web',
              app_version: this.config.appVersion ?? '0.1.0',
              sdk_version: '0.1.0',
              device_id: this.config.deviceId,
            },
            audio: {
              codec: 'pcm_s16le',
              sample_rate_hz: 16000,
              channels: 1,
              chunk_duration_ms: 40,
            },
            capabilities: {
              aec: true,
              noise_suppression: true,
              agc: true,
              vad: true,
              resend: true,
            },
          });

          this.sendControlEvent('source.register', {
            participant_id: this.config.participantId,
            speaker_id: this.config.speakerId,
            speaker_state: this.config.speakerId ? 'assigned' : 'unknown',
            language_hint: this.config.languageHint,
            microphone: {
              label: this.config.sourceId,
              channel: 0,
            },
          });
        }

        if (!settled) {
          settled = true;
          resolve();
        }
      };

      ws.onmessage = (evt) => this.handleMessage(evt);

      ws.onerror = () => {
        this.events.onLog?.('WebSocket error');
      };

      ws.onclose = () => {
        clearTimeout(connectTimeout);
        this.stopHeartbeat();
        if (this.closedByUser) {
          this.setState('closed');
        } else {
          this.setState('reconnecting');
          this.scheduleReconnect();
        }
        if (!settled) {
          settled = true;
          reject(new Error('WebSocket closed before connecting'));
        }
      };
    });
  }

  disconnect(): void {
    this.closedByUser = true;
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
  }

  /** D12: resend the utterance.start/end that may not have reached the gateway before the drop. */
  private resendControlCheckpoint(): void {
    if (this.utteranceActive && this.lastUtteranceStart) {
      this.events.onLog?.(`Resending utterance.start for ${this.lastUtteranceStart.utterance_id} (D12)`);
      this.sendRaw(this.lastUtteranceStart);
      return;
    }

    const endedRecently =
      this.lastUtteranceEnd && Date.now() - this.lastUtteranceEndAt < UTTERANCE_END_RESEND_WINDOW_MS;
    if (endedRecently && this.lastUtteranceEnd) {
      this.events.onLog?.(`Resending utterance.end for ${this.lastUtteranceEnd.utterance_id} (D12)`);
      this.sendRaw(this.lastUtteranceEnd);
    }
  }

  sendUtteranceStart(partial: UtteranceStartPartial): void {
    const event: UtteranceStartEvent = {
      protocol_version: PROTOCOL_VERSION,
      type: 'utterance.start',
      event_id: uuidv4(),
      session_id: this.config.sessionId,
      stream_id: this.config.streamId,
      source_id: this.config.sourceId,
      sent_at: new Date().toISOString(),
      ...partial,
    };
    this.utteranceActive = true;
    this.lastUtteranceStart = event;
    this.sendRaw(event);
  }

  sendUtteranceEnd(partial: UtteranceEndPartial): void {
    const event: UtteranceEndEvent = {
      protocol_version: PROTOCOL_VERSION,
      type: 'utterance.end',
      event_id: uuidv4(),
      session_id: this.config.sessionId,
      stream_id: this.config.streamId,
      source_id: this.config.sourceId,
      sent_at: new Date().toISOString(),
      ...partial,
    };
    this.utteranceActive = false;
    this.lastUtteranceEnd = event;
    this.lastUtteranceEndAt = Date.now();
    this.sendRaw(event);
  }

  sendAudioChunk(partial: AudioChunkPartial, payload: Int16Array): void {
    const sequence = this.sequence++;
    const metadata: AudioChunkMetadata = {
      protocol_version: PROTOCOL_VERSION,
      type: 'audio.chunk',
      session_id: this.config.sessionId,
      stream_id: this.config.streamId,
      source_id: this.config.sourceId,
      connection_id: this.connectionId,
      sequence,
      ...partial,
    };

    const frame = encodeAudioFrame(metadata, payload);
    this.resendBuffer.push({ sequence, frame, enqueuedAt: Date.now() });
    this.trimResendBufferByAge();

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(frame);
      this.lastActivityAt = Date.now();
    }
  }

  private setState(state: ConnectionState) {
    this.state = state;
    this.events.onStateChange?.(state);
  }

  private scheduleReconnect(delayMs = 1500) {
    if (this.closedByUser) return;
    setTimeout(() => {
      if (this.closedByUser) return;
      this.connect(true).catch((err) => {
        this.events.onLog?.(`Reconnect failed: ${String(err)}`);
        this.scheduleReconnect(Math.min(delayMs * 1.5, 10000));
      });
    }, delayMs);
  }

  private startHeartbeat() {
    const intervalMs = this.config.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      const idleMs = Date.now() - this.lastActivityAt;
      if (idleMs >= intervalMs) {
        this.sendHeartbeatPing();
      }
    }, Math.min(intervalMs, 5000));
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.heartbeatWatchdog) clearTimeout(this.heartbeatWatchdog);
    this.heartbeatTimer = null;
    this.heartbeatWatchdog = null;
  }

  private sendHeartbeatPing() {
    this.sendControlEvent('heartbeat.ping', {});

    const timeoutMs = this.config.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
    this.heartbeatWatchdog = setTimeout(() => {
      this.missedPongs += 1;
      this.events.onLog?.(`Missed heartbeat pong (${this.missedPongs})`);
      if (this.missedPongs >= 2) {
        this.events.onLog?.('Connection considered stale, forcing reconnect');
        this.ws?.close();
      }
    }, timeoutMs);
  }

  private handleMessage(evt: MessageEvent<unknown>) {
    this.lastActivityAt = Date.now();
    if (typeof evt.data !== 'string') return;

    const message = JSON.parse(evt.data) as { type: string } & Record<string, unknown>;

    switch (message.type) {
      case 'heartbeat.pong':
        this.missedPongs = 0;
        if (this.heartbeatWatchdog) clearTimeout(this.heartbeatWatchdog);
        break;

      case 'stream.ack': {
        const ack = message as unknown as StreamAckEvent;
        this.highestAcked = Math.max(this.highestAcked, ack.highest_contiguous_sequence);
        this.pruneResendBuffer();
        this.events.onServerAck?.(ack);
        break;
      }

      case 'stream.throttle':
        this.setState('throttled');
        this.events.onThrottle?.(message as unknown as StreamThrottleEvent);
        break;

      case 'error': {
        const err = message as unknown as ErrorEvent;
        this.events.onLog?.(`Server error: ${err.code} - ${err.message}`);
        if (err.code === 'SERVER_BACKPRESSURE') {
          this.events.onBackpressure?.(err);
          const retryAfter = err.retry_after_ms ?? 2000;
          this.ws?.close();
          setTimeout(() => this.connect(true).catch(() => undefined), retryAfter);
        }
        break;
      }

      case 'stt.partial':
      case 'stt.final': {
        const stt = message as unknown as {
          type: string;
          text: string;
          language: string;
          backend: string;
          asr_latency_ms: number;
          utterance_id: string;
          low_confidence?: boolean;
          source_id?: string;
          speaker_id?: string | null;
        };
        this.events.onSttResult?.({
          type: stt.type === 'stt.final' ? 'final' : 'partial',
          text: stt.text || '',
          language: stt.language || 'auto',
          backend: stt.backend || 'auto',
          latencyMs: stt.asr_latency_ms || 0,
          utteranceId: stt.utterance_id || '',
          lowConfidence: stt.low_confidence === true,
          sourceId: stt.source_id,
          speakerId: stt.speaker_id ?? null,
        });
        break;
      }

      case 'stt.error': {
        const err = message as unknown as { utterance_id?: string | null; message?: string };
        this.events.onSttError?.({
          utteranceId: err.utterance_id ?? null,
          message: err.message || 'stt_error',
        });
        break;
      }

      case 'translation.final': {
        const tr = message as unknown as {
          utterance_id: string;
          source_text: string;
          translated_text: string;
          source_lang: string;
          target_lang: string;
          model: string;
          translation_latency_ms: number;
          source_id?: string;
          speaker_id?: string | null;
        };
        this.events.onTranslationResult?.({
          utteranceId: tr.utterance_id || '',
          sourceText: tr.source_text || '',
          translatedText: tr.translated_text || '',
          sourceLang: tr.source_lang || 'vi',
          targetLang: tr.target_lang || 'en',
          model: tr.model || '',
          latencyMs: tr.translation_latency_ms || 0,
          sourceId: tr.source_id,
          speakerId: tr.speaker_id ?? null,
        });
        break;
      }

      default:
        this.events.onLog?.(`Unhandled control event: ${message.type}`);
    }
  }

  private sendControlEvent(type: string, partial: Record<string, unknown>): void {
    const event = {
      protocol_version: PROTOCOL_VERSION,
      type,
      event_id: uuidv4(),
      session_id: this.config.sessionId,
      stream_id: this.config.streamId,
      source_id: this.config.sourceId,
      sent_at: new Date().toISOString(),
      ...partial,
    };
    this.sendRaw(event);
  }

  private sendRaw(event: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
      this.lastActivityAt = Date.now();
    }
  }

  /**
   * Drain the resend buffer in batches (R4 — Thundering Herd fix).
   *
   * Instead of blasting all buffered chunks at once when the connection
   * recovers, we send FLUSH_BATCH_SIZE frames every FLUSH_INTERVAL_MS.
   * This prevents a sudden spike that could overwhelm the ingestion gateway
   * when many clients reconnect simultaneously after a network blip.
   */
  private flushResendBuffer() {
    const FLUSH_BATCH_SIZE = 5;      // 5 × 40ms = 200ms of audio per tick
    const FLUSH_INTERVAL_MS = 50;    // one tick every 50ms

    const pending = this.resendBuffer.filter(b => b.sequence > this.highestAcked);
    if (pending.length === 0) return;

    this.events.onLog?.(
      `Throttled resend: ${pending.length} buffered chunk(s), ` +
      `batch=${FLUSH_BATCH_SIZE}, interval=${FLUSH_INTERVAL_MS}ms`
    );

    let idx = 0;
    const sendBatch = () => {
      if (this.closedByUser) return;
      const batch = pending.slice(idx, idx + FLUSH_BATCH_SIZE);
      for (const buffered of batch) {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(buffered.frame);
        }
      }
      idx += FLUSH_BATCH_SIZE;
      if (idx < pending.length) {
        setTimeout(sendBatch, FLUSH_INTERVAL_MS);
      }
    };
    sendBatch();
  }

  private pruneResendBuffer() {
    this.resendBuffer = this.resendBuffer.filter((b) => b.sequence > this.highestAcked);
  }

  private trimResendBufferByAge() {
    const maxAgeMs = this.config.resendBufferMs ?? DEFAULT_RESEND_BUFFER_MS;
    const cutoff = Date.now() - maxAgeMs;
    this.resendBuffer = this.resendBuffer.filter((b) => b.enqueuedAt >= cutoff);
  }
}
