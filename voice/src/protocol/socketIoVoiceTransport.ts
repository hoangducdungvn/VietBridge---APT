import { v4 as uuidv4 } from 'uuid';
import type { Socket } from 'socket.io-client';
import type {
  AudioChunkPartial,
  ConnectionState,
  SttResultEvent,
  UtteranceEndPartial,
  UtteranceStartPartial,
  VoiceStreamClientConfig,
  VoiceStreamClientEvents,
} from './wsClient';
import type { VoiceTransport } from './voiceTransport';

interface PendingChunk {
  payload: Int16Array;
}

export class SocketIoVoiceTransport implements VoiceTransport {
  private activeTurnId: string | undefined;
  private pendingChunks: PendingChunk[] = [];
  private pendingEnd = false;
  private sequence = 0;
  private state: ConnectionState = 'idle';
  private listenersAttached = false;

  constructor(
    private readonly socket: Socket,
    private readonly config: VoiceStreamClientConfig,
    private readonly events: VoiceStreamClientEvents = {},
  ) {}

  async connect(): Promise<void> {
    this.attachListeners();
    if (this.socket.connected) {
      this.setState('connected');
      return;
    }

    this.setState('connecting');
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Socket.IO connection timed out')),
        8000,
      );
      const onConnect = () => {
        clearTimeout(timeout);
        this.socket.off('connect_error', onError);
        resolve();
      };
      const onError = (error: Error) => {
        clearTimeout(timeout);
        this.socket.off('connect', onConnect);
        reject(error);
      };
      this.socket.once('connect', onConnect);
      this.socket.once('connect_error', onError);
      if (!this.socket.active) this.socket.connect();
    });
  }

  disconnect(): void {
    if (this.activeTurnId !== undefined) {
      this.emitTurnControl('turn.cancel', this.activeTurnId);
    }
    this.resetTurn();
    this.detachListeners();
    this.setState('closed');
  }

  getCurrentSequence(): number {
    return this.sequence;
  }

  getState(): ConnectionState {
    return this.state;
  }

  sendUtteranceStart(_partial: UtteranceStartPartial): void {
    this.resetTurn();
    this.socket.emit('turn.start', {
      eventId: uuidv4(),
      participantId: this.config.participantId,
      payload: {
        audioConfig: {
          channels: 1,
          codec: 'pcm_s16le',
          sampleRate: 16_000,
        },
      },
      sessionId: this.config.sessionId,
      type: 'turn.start',
    });
  }

  sendAudioChunk(_partial: AudioChunkPartial, payload: Int16Array): void {
    const copy = new Int16Array(payload);
    if (this.activeTurnId === undefined) {
      this.pendingChunks.push({ payload: copy });
      return;
    }
    this.emitAudio(copy);
  }

  sendUtteranceEnd(_partial: UtteranceEndPartial): void {
    if (this.activeTurnId === undefined) {
      this.pendingEnd = true;
      return;
    }
    this.emitTurnControl('turn.end', this.activeTurnId);
  }

  private readonly onConnect = (): void => this.setState('connected');
  private readonly onDisconnect = (): void => this.setState('reconnecting');
  private readonly onTurnAccepted = (value: unknown): void => {
    const turnId = readString(value, 'turnId');
    if (turnId === undefined) return;
    this.activeTurnId = turnId;
    for (const chunk of this.pendingChunks) this.emitAudio(chunk.payload);
    this.pendingChunks = [];
    if (this.pendingEnd) {
      this.pendingEnd = false;
      this.emitTurnControl('turn.end', turnId);
    }
  };
  private readonly onTurnRejected = (value: unknown): void => {
    const payload = readRecord(value, 'payload');
    const code = readString(payload, 'code') ?? 'TURN_REJECTED';
    const message = readString(payload, 'message') ?? 'Speaking turn rejected.';
    this.resetTurn();
    this.events.onBackpressure?.({ code, message } as never);
  };
  private readonly onPipelineError = (value: unknown): void => {
    const payload = readRecord(value, 'payload');
    const code = readString(payload, 'code') ?? 'PIPELINE_ERROR';
    const message = readString(payload, 'message') ?? 'Audio pipeline failed.';
    const failedTurnId = readString(value, 'turnId');
    if (failedTurnId === undefined || failedTurnId === this.activeTurnId) {
      this.resetTurn();
    }
    this.events.onBackpressure?.({ code, message } as never);
  };
  private readonly onSttPartial = (value: unknown): void =>
    this.emitSttResult(value, 'partial');
  private readonly onSttFinal = (value: unknown): void => {
    this.emitSttResult(value, 'final');
    const completedTurnId = readString(value, 'turnId');
    if (
      completedTurnId !== undefined &&
      completedTurnId === this.activeTurnId
    ) {
      this.resetTurn();
    }
  };

  private attachListeners(): void {
    if (this.listenersAttached) return;
    this.listenersAttached = true;
    this.socket.on('connect', this.onConnect);
    this.socket.on('disconnect', this.onDisconnect);
    this.socket.on('turn.accepted', this.onTurnAccepted);
    this.socket.on('turn.rejected', this.onTurnRejected);
    this.socket.on('pipeline.error', this.onPipelineError);
    this.socket.on('stt.partial', this.onSttPartial);
    this.socket.on('stt.final', this.onSttFinal);
  }

  private detachListeners(): void {
    if (!this.listenersAttached) return;
    this.listenersAttached = false;
    this.socket.off('connect', this.onConnect);
    this.socket.off('disconnect', this.onDisconnect);
    this.socket.off('turn.accepted', this.onTurnAccepted);
    this.socket.off('turn.rejected', this.onTurnRejected);
    this.socket.off('pipeline.error', this.onPipelineError);
    this.socket.off('stt.partial', this.onSttPartial);
    this.socket.off('stt.final', this.onSttFinal);
  }

  private emitAudio(payload: Int16Array): void {
    if (this.activeTurnId === undefined) return;
    this.socket.emit('audio.chunk', {
      audio: payload,
      participantId: this.config.participantId,
      sequence: this.sequence,
      sessionId: this.config.sessionId,
      turnId: this.activeTurnId,
    });
    this.sequence += 1;
  }

  private emitTurnControl(type: 'turn.end' | 'turn.cancel', turnId: string): void {
    this.socket.emit(type, {
      eventId: uuidv4(),
      participantId: this.config.participantId,
      payload: {},
      sessionId: this.config.sessionId,
      turnId,
      type,
    });
  }

  private emitSttResult(value: unknown, type: 'partial' | 'final'): void {
    const payload = readRecord(value, 'payload');
    const result: SttResultEvent = {
      backend: readString(payload, 'backend') ?? 'unknown',
      language: readString(payload, 'language') ?? this.config.languageHint,
      latencyMs: readNumber(payload, 'providerLatencyMs') ?? 0,
      text: readString(payload, 'text') ?? '',
      type,
      utteranceId: readString(value, 'turnId') ?? this.activeTurnId ?? '',
    };
    this.events.onSttResult?.(result);
  }

  private resetTurn(): void {
    this.activeTurnId = undefined;
    this.pendingChunks = [];
    this.pendingEnd = false;
    this.sequence = 0;
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    this.events.onStateChange?.(state);
  }
}

function readRecord(value: unknown, key: string): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const child = value[key];
  return isRecord(child) ? child : {};
}

function readString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === 'string' ? field : undefined;
}

function readNumber(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === 'number' ? field : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
