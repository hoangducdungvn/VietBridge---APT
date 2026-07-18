import { io, type Socket } from 'socket.io-client';
import type { ParticipantSession } from '@domain/entities/BackendSession';
import { env } from '@infrastructure/config/env';

interface SessionSocketHandlers {
  onConnectionChange: (connected: boolean, socket?: Socket) => void;
  onError: (message: string) => void;
  onSessionState: () => void;
  onSttResult: (result: RealtimeSttResult) => void;
  onTranslationResult?: (result: RealtimeTranslationResult) => void;
}

export interface RealtimeSttResult {
  backend: string;
  language: 'vi' | 'en';
  participantId: string;
  /** source_id from the audio source (identifies speaker in multi-client sessions). */
  sourceId?: string;
  providerLatencyMs: number;
  receivedAt: number;
  text: string;
  turnId: string;
  type: 'partial' | 'final';
}

export interface RealtimeTranslationResult {
  utteranceId: string;
  sourceText: string;
  translatedText: string;
  sourceLang: 'vi' | 'en';
  targetLang: 'vi' | 'en';
  model: string;
  latencyMs: number;
  /** source_id from the audio source — identifies who spoke. */
  sourceId?: string;
}

export class SessionSocketClient {
  private socket?: Socket;

  connect(session: ParticipantSession, handlers: SessionSocketHandlers): void {
    this.disconnect();
    this.socket = io(env.backendWsUrl, {
      auth: { accessToken: session.accessToken },
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3_000,
      timeout: 10_000,
      transports: ['polling', 'websocket']
    });
    const socket = this.socket;
    handlers.onConnectionChange(false);

    socket.on('connect', () => {
      handlers.onConnectionChange(true, socket);
    });

    socket.on('disconnect', () => {
      handlers.onConnectionChange(false);
    });

    socket.on('session.state', (payload: unknown) => {
      if (
        typeof payload === 'object' &&
        payload !== null &&
        !Array.isArray(payload) &&
        'sessionId' in payload &&
        payload.sessionId === session.sessionId
      ) {
        handlers.onSessionState();
      }
    });

    socket.on('connect_error', (error) => {
      handlers.onConnectionChange(false);
      handlers.onError(readSocketError(error));
    });

    socket.on('stt.partial', (payload: unknown) => {
      const result = parseSttResult(payload, 'partial');
      if (result !== undefined) handlers.onSttResult(result);
    });

    socket.on('stt.final', (payload: unknown) => {
      const result = parseSttResult(payload, 'final');
      if (result !== undefined) handlers.onSttResult(result);
    });

    socket.on('translation.final', (payload: unknown) => {
      const result = parseTranslationResult(payload);
      if (result !== undefined) handlers.onTranslationResult?.(result);
    });

    socket.connect();
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = undefined;
  }
}

function readSocketError(error: Error): string {
  const data = (error as Error & { data?: unknown }).data;
  if (isRecord(data) && typeof data.message === 'string') {
    return data.message;
  }
  return error.message || 'Realtime connection failed.';
}

function parseSttResult(value: unknown, type: 'partial' | 'final'): RealtimeSttResult | undefined {
  if (!isRecord(value) || !isRecord(value.payload)) return undefined;
  const payload = value.payload;
  if (
    typeof value.turnId !== 'string' ||
    typeof payload.text !== 'string' ||
    (payload.language !== 'vi' && payload.language !== 'en') ||
    typeof payload.participantId !== 'string'
  ) {
    return undefined;
  }
  return {
    backend: typeof payload.backend === 'string' ? payload.backend : 'unknown',
    language: payload.language,
    participantId: payload.participantId,
    sourceId: typeof payload.sourceId === 'string' ? payload.sourceId : undefined,
    providerLatencyMs:
      typeof payload.providerLatencyMs === 'number' ? payload.providerLatencyMs : 0,
    receivedAt: Date.now(),
    text: payload.text,
    turnId: value.turnId,
    type
  };
}

/**
 * Parse a raw translation.final message from the WS mock-server (not the NestJS Socket.IO format).
 * The mock-server sends the payload directly as the message object (not wrapped in {turnId, payload}).
 */
function parseTranslationResult(value: unknown): RealtimeTranslationResult | undefined {
  if (!isRecord(value)) return undefined;

  // Handle both: raw WS message from mock-server, and NestJS-wrapped payload
  const data: Record<string, unknown> = isRecord(value.payload) ? value.payload : value;

  const utteranceId = typeof data.utterance_id === 'string' ? data.utterance_id
    : typeof data.utteranceId === 'string' ? data.utteranceId : undefined;
  const translatedText = typeof data.translated_text === 'string' ? data.translated_text
    : typeof data.translatedText === 'string' ? data.translatedText : undefined;
  const sourceText = typeof data.source_text === 'string' ? data.source_text
    : typeof data.sourceText === 'string' ? data.sourceText : undefined;
  const sourceLang = typeof data.source_lang === 'string' ? data.source_lang
    : typeof data.sourceLang === 'string' ? data.sourceLang : undefined;
  const targetLang = typeof data.target_lang === 'string' ? data.target_lang
    : typeof data.targetLang === 'string' ? data.targetLang : undefined;
  const model = typeof data.model === 'string' ? data.model : 'unknown';
  const latencyMs = typeof data.translation_latency_ms === 'number' ? data.translation_latency_ms
    : typeof data.latencyMs === 'number' ? data.latencyMs : 0;
  const sourceId = typeof data.source_id === 'string' ? data.source_id
    : typeof data.sourceId === 'string' ? data.sourceId : undefined;

  if (!utteranceId || !translatedText || !sourceText || !sourceLang || !targetLang) return undefined;
  if (sourceLang !== 'vi' && sourceLang !== 'en') return undefined;
  if (targetLang !== 'vi' && targetLang !== 'en') return undefined;

  return {
    utteranceId,
    sourceText,
    translatedText,
    sourceLang,
    targetLang,
    model,
    latencyMs,
    sourceId,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
