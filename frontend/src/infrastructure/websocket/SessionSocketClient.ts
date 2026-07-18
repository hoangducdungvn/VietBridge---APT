import { io, type Socket } from 'socket.io-client';
import type { ParticipantSession } from '@domain/entities/BackendSession';
import { env } from '@infrastructure/config/env';

interface SessionSocketHandlers {
  onConnectionChange: (connected: boolean, socket?: Socket) => void;
  onError: (message: string) => void;
  onMessageFinal: (message: RealtimeMessageFinal) => void;
  onSessionState: () => void;
  onSttResult: (result: RealtimeSttResult) => void;
}

export interface RealtimeSttResult {
  backend: string;
  language: 'vi' | 'en';
  participantId: string;
  providerLatencyMs: number;
  receivedAt: number;
  text: string;
  turnId: string;
  type: 'partial' | 'final';
}

export interface RealtimeMessageFinal {
  createdAt: number;
  latency: {
    endToEndMs: number;
    sttFinalMs: number;
    translationMs: number;
  };
  messageId: string;
  sequence: number;
  sourceLanguage: 'vi' | 'en';
  sourceText: string;
  speaker: {
    displayName: string;
    participantId: string;
  };
  targetLanguage: 'vi' | 'en';
  translatedText: string;
  turnId: string;
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

    socket.on('message.final', (payload: unknown) => {
      const message = parseMessageFinal(payload);
      if (message !== undefined) handlers.onMessageFinal(message);
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
    providerLatencyMs:
      typeof payload.providerLatencyMs === 'number' ? payload.providerLatencyMs : 0,
    receivedAt: Date.now(),
    text: payload.text,
    turnId: value.turnId,
    type
  };
}

function parseMessageFinal(value: unknown): RealtimeMessageFinal | undefined {
  if (!isRecord(value) || !isRecord(value.payload)) return undefined;
  const payload = value.payload;
  if (!isRecord(payload.speaker) || !isRecord(payload.latency)) return undefined;
  if (
    typeof value.turnId !== 'string' ||
    typeof payload.messageId !== 'string' ||
    typeof payload.sequence !== 'number' ||
    !Number.isInteger(payload.sequence) ||
    (payload.sourceLanguage !== 'vi' && payload.sourceLanguage !== 'en') ||
    (payload.targetLanguage !== 'vi' && payload.targetLanguage !== 'en') ||
    typeof payload.sourceText !== 'string' ||
    typeof payload.translatedText !== 'string' ||
    typeof payload.createdAt !== 'number' ||
    typeof payload.speaker.participantId !== 'string' ||
    typeof payload.speaker.displayName !== 'string' ||
    typeof payload.latency.sttFinalMs !== 'number' ||
    typeof payload.latency.translationMs !== 'number' ||
    typeof payload.latency.endToEndMs !== 'number'
  ) {
    return undefined;
  }

  return {
    createdAt: payload.createdAt,
    latency: {
      endToEndMs: payload.latency.endToEndMs,
      sttFinalMs: payload.latency.sttFinalMs,
      translationMs: payload.latency.translationMs
    },
    messageId: payload.messageId,
    sequence: payload.sequence,
    sourceLanguage: payload.sourceLanguage,
    sourceText: payload.sourceText,
    speaker: {
      displayName: payload.speaker.displayName,
      participantId: payload.speaker.participantId
    },
    targetLanguage: payload.targetLanguage,
    translatedText: payload.translatedText,
    turnId: value.turnId
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
