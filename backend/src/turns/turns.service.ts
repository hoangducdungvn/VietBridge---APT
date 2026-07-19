import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiHttpException } from '../common/errors/api-http.exception';
import type { SttEouMetadata } from '../common/types/stt-eou.type';
import { StructuredLogger } from '../observability/structured-logger.service';
import { ParticipantsService } from '../participants/participants.service';
import { SessionStore } from '../sessions/session.store';
import { SessionsService } from '../sessions/sessions.service';
import { TurnStore } from './turn.store';
import type {
  AudioChunkInput,
  EndTurnResult,
  StartTurnResult,
  StoredTurn,
  TurnAudioConfig,
  TurnTranscriptionSnapshot,
} from './turn.types';

const MAX_TURN_DURATION_SECONDS = 25;
const PCM_BYTES_PER_SAMPLE = 2;
const PCM_SAMPLE_RATE = 16_000;
const MAX_TURN_AUDIO_BYTES =
  MAX_TURN_DURATION_SECONDS * PCM_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE;
const MAX_AUDIO_CHUNK_BYTES = 64_000;

@Injectable()
export class TurnsService {
  private sessionCleanupHandler: (turnIds: string[]) => void = () => undefined;

  constructor(
    private readonly logger: StructuredLogger,
    private readonly participantsService: ParticipantsService,
    private readonly sessionStore: SessionStore,
    private readonly sessionsService: SessionsService,
    private readonly turnStore: TurnStore,
  ) {
    this.sessionsService.registerConversationCleanupHandler((sessionId) =>
      this.clearSession(sessionId),
    );
  }

  registerSessionCleanupHandler(handler: (turnIds: string[]) => void): void {
    this.sessionCleanupHandler = handler;
  }

  clearSession(sessionId: string): void {
    const turnIds = this.turnStore.deleteBySessionId(sessionId);
    this.sessionCleanupHandler(turnIds);
  }

  startTurn(
    sessionId: string,
    participantId: string,
    audioConfigValue: unknown,
  ): StartTurnResult {
    const session = this.sessionsService.getSessionById(sessionId);
    const participant =
      this.participantsService.getRequiredParticipant(participantId);

    if (participant.sessionId !== sessionId) {
      throw turnError(
        'INVALID_TOKEN',
        'Participant does not belong to session.',
      );
    }
    if (session.status !== 'active') {
      throw turnError(
        'INVALID_TURN_STATE',
        'The session is not active and cannot accept a turn.',
      );
    }
    const staleTurn = this.turnStore.findCapturingByParticipant(
      sessionId,
      participantId,
    );
    if (staleTurn !== undefined) {
      this.cancelTurn(sessionId, participantId, staleTurn.turnId);
      this.sessionCleanupHandler([staleTurn.turnId]);
    }

    const audioConfig = parseAudioConfig(audioConfigValue);
    const turnId = `turn_${randomUUID()}`;
    const turn: StoredTurn = {
      audioBytes: 0,
      audioChunks: [],
      audioConfig,
      lastAudioSequence: -1,
      participantId,
      sequence: session.nextTurnSequence,
      sessionId,
      sourceLanguage: participant.sourceLanguage,
      startedAt: Date.now(),
      status: 'started',
      targetLanguage: participant.targetLanguage,
      turnId,
    };

    this.turnStore.save(turn);
    session.nextTurnSequence += 1;
    session.lastActivityAt = Date.now();
    this.sessionStore.save(session);
    this.logTurnEvent('turn.started', turn, 'success', null);

    return { sequence: turn.sequence, turnId };
  }

  appendAudio(input: AudioChunkInput): void {
    const turn = this.getRequiredTurn(input.turnId);
    this.assertTurnOwner(turn, input.sessionId, input.participantId);

    if (turn.status !== 'started' && turn.status !== 'streaming') {
      throw turnError(
        'INVALID_TURN_STATE',
        'Audio is only accepted for an active turn.',
      );
    }

    try {
      if (!Number.isInteger(input.sequence) || input.sequence < 0) {
        throw turnError(
          'AUDIO_CHUNK_OUT_OF_ORDER',
          'Audio sequence must be a non-negative integer.',
        );
      }
      if (input.sequence !== turn.lastAudioSequence + 1) {
        throw turnError(
          'AUDIO_CHUNK_OUT_OF_ORDER',
          `Expected audio sequence ${turn.lastAudioSequence + 1}.`,
        );
      }

      const audio = toAudioBuffer(input.audio);
      if (
        audio.length === 0 ||
        audio.length % PCM_BYTES_PER_SAMPLE !== 0 ||
        audio.length > MAX_AUDIO_CHUNK_BYTES
      ) {
        throw turnError(
          'INVALID_AUDIO_CONFIG',
          'Audio chunks must contain non-empty PCM16 data within the chunk limit.',
        );
      }
      if (turn.audioBytes + audio.length > MAX_TURN_AUDIO_BYTES) {
        throw turnError(
          'TURN_DURATION_EXCEEDED',
          `A turn cannot exceed ${MAX_TURN_DURATION_SECONDS} seconds.`,
        );
      }

      const now = Date.now();
      turn.audioChunks.push(Buffer.from(audio));
      turn.audioBytes += audio.length;
      turn.lastAudioSequence = input.sequence;
      turn.firstAudioAt ??= now;
      turn.lastAudioAt = now;
      turn.status = 'streaming';
      this.turnStore.save(turn);
    } catch (error: unknown) {
      this.failTurn(turn, extractErrorCode(error));
      throw error;
    }
  }

  endTurn(
    sessionId: string,
    participantId: string,
    turnId: string,
  ): EndTurnResult {
    const snapshot = this.beginTurnEnd(sessionId, participantId, turnId);
    if (snapshot.duplicate) {
      return snapshot.result;
    }
    return this.completeTurn(
      turnId,
      snapshot.audio.language === 'vi'
        ? 'Bản ghi STT mô phỏng cho lượt nói.'
        : 'Mock STT transcript for the speaking turn.',
      'mock',
      0,
    );
  }

  beginTurnEnd(
    sessionId: string,
    participantId: string,
    turnId: string,
  ):
    | { duplicate: true; result: EndTurnResult }
    | { audio: TurnTranscriptionSnapshot; duplicate: false } {
    const turn = this.getRequiredTurn(turnId);
    this.assertTurnOwner(turn, sessionId, participantId);

    if (turn.status === 'completed' || turn.status === 'processing') {
      return { duplicate: true, result: this.toEndResult(turn, true) };
    }
    if (turn.status !== 'started' && turn.status !== 'streaming') {
      throw turnError(
        'INVALID_TURN_STATE',
        'The turn cannot be ended from its current state.',
      );
    }

    turn.status = 'processing';
    this.turnStore.save(turn);
    return { audio: this.toTranscriptionSnapshot(turn), duplicate: false };
  }

  getPartialSnapshot(
    sessionId: string,
    participantId: string,
    turnId: string,
  ): TurnTranscriptionSnapshot | undefined {
    const turn = this.getRequiredTurn(turnId);
    this.assertTurnOwner(turn, sessionId, participantId);
    if (turn.status !== 'streaming' || turn.audioBytes === 0) {
      return undefined;
    }
    return this.toTranscriptionSnapshot(turn);
  }

  completeTurn(
    turnId: string,
    text: string,
    backend?: string,
    providerLatencyMs?: number,
    lowConfidence?: boolean,
    eou?: SttEouMetadata,
  ): EndTurnResult {
    const turn = this.getRequiredTurn(turnId);
    if (turn.status === 'completed' || turn.status !== 'processing') {
      return this.toEndResult(turn, true);
    }

    turn.finalText = text;
    turn.sttBackend = backend;
    turn.providerLatencyMs = providerLatencyMs;
    turn.lowConfidence = lowConfidence;
    turn.eou = eou;
    turn.completedAt = Date.now();
    turn.status = 'completed';
    this.clearAudio(turn);
    this.recordTurnCompletion(turn, true);
    this.turnStore.save(turn);
    this.logTurnEvent('turn.completed', turn, 'success', null);
    return this.toEndResult(turn, false);
  }

  failTurnProcessing(turnId: string, errorCode: string): void {
    const turn = this.getRequiredTurn(turnId);
    if (turn.status === 'processing') {
      this.failTurn(turn, errorCode);
    }
  }

  cancelTurn(sessionId: string, participantId: string, turnId: string): void {
    const turn = this.getRequiredTurn(turnId);
    this.assertTurnOwner(turn, sessionId, participantId);

    if (turn.status === 'cancelled' || turn.status === 'completed') {
      return;
    }

    turn.status = 'cancelled';
    this.clearAudio(turn);
    this.recordTurnCompletion(turn, false);
    this.turnStore.save(turn);
    this.logTurnEvent('turn.cancelled', turn, 'success', null);
  }

  cancelOpenTurnsForParticipant(
    sessionId: string,
    participantId: string,
  ): void {
    for (const turn of this.turnStore.findOpenByParticipant(
      sessionId,
      participantId,
    )) {
      this.cancelTurn(sessionId, participantId, turn.turnId);
    }
  }

  private getRequiredTurn(turnId: string): StoredTurn {
    const turn = this.turnStore.findById(turnId);
    if (turn === undefined) {
      throw turnError(
        'TURN_NOT_FOUND',
        'The turn was not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return turn;
  }

  private assertTurnOwner(
    turn: StoredTurn,
    sessionId: string,
    participantId: string,
  ): void {
    if (turn.sessionId !== sessionId || turn.participantId !== participantId) {
      throw turnError(
        'INVALID_TOKEN',
        'The turn does not belong to this participant.',
      );
    }
  }

  private failTurn(turn: StoredTurn, errorCode: string): void {
    turn.errorCode = errorCode;
    turn.status = 'failed';
    this.clearAudio(turn);
    this.recordTurnCompletion(turn, false);
    this.turnStore.save(turn);
    this.logTurnEvent('turn.failed', turn, 'error', errorCode);
  }

  private clearAudio(turn: StoredTurn): void {
    turn.audioChunks = [];
    turn.audioBytes = 0;
  }

  private recordTurnCompletion(
    turn: StoredTurn,
    addToRecentTurns: boolean,
  ): void {
    const session = this.sessionStore.findById(turn.sessionId);
    if (session === undefined) {
      return;
    }

    session.lastActivityAt = Date.now();
    if (addToRecentTurns && !session.recentTurnIds.includes(turn.turnId)) {
      session.recentTurnIds.push(turn.turnId);
    }
    this.sessionStore.save(session);
  }

  private toEndResult(turn: StoredTurn, duplicate: boolean): EndTurnResult {
    return {
      ...(turn.sttBackend === undefined ? {} : { backend: turn.sttBackend }),
      duplicate,
      ...(turn.eou === undefined ? {} : { eou: turn.eou }),
      language: turn.sourceLanguage,
      ...(turn.lowConfidence === undefined
        ? {}
        : { lowConfidence: turn.lowConfidence }),
      participantId: turn.participantId,
      ...(turn.providerLatencyMs === undefined
        ? {}
        : { providerLatencyMs: turn.providerLatencyMs }),
      sequence: turn.sequence,
      startedAt: turn.startedAt,
      targetLanguage: turn.targetLanguage,
      text: turn.finalText ?? '',
      turnId: turn.turnId,
    };
  }

  private toTranscriptionSnapshot(turn: StoredTurn): TurnTranscriptionSnapshot {
    return {
      audio: Buffer.concat(turn.audioChunks, turn.audioBytes),
      language: turn.sourceLanguage,
      participantId: turn.participantId,
      sessionId: turn.sessionId,
      turnId: turn.turnId,
    };
  }

  private logTurnEvent(
    event: string,
    turn: StoredTurn,
    status: string,
    errorCode: string | null,
  ): void {
    this.logger.log(
      {
        durationMs: Date.now() - turn.startedAt,
        errorCode,
        event,
        participantId: turn.participantId,
        sessionId: turn.sessionId,
        status,
        turnId: turn.turnId,
      },
      TurnsService.name,
    );
  }
}

function parseAudioConfig(value: unknown): TurnAudioConfig {
  if (
    !isRecord(value) ||
    value.codec !== 'pcm_s16le' ||
    value.sampleRate !== PCM_SAMPLE_RATE ||
    value.channels !== 1
  ) {
    throw turnError(
      'INVALID_AUDIO_CONFIG',
      'Audio must be pcm_s16le, 16000 Hz, mono.',
    );
  }

  return { channels: 1, codec: 'pcm_s16le', sampleRate: PCM_SAMPLE_RATE };
}

function toAudioBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return Buffer.from(value);
  }
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  throw turnError('INVALID_AUDIO_CONFIG', 'Audio chunk must be binary data.');
}

function turnError(
  code: string,
  message: string,
  status: HttpStatus = HttpStatus.CONFLICT,
): ApiHttpException {
  return new ApiHttpException(status, code, message);
}

function extractErrorCode(error: unknown): string {
  if (error instanceof ApiHttpException) {
    const response = error.getResponse();
    if (isRecord(response) && typeof response.code === 'string') {
      return response.code;
    }
  }
  return 'INTERNAL_ERROR';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
