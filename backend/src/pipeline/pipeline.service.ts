import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ApiHttpException } from '../common/errors/api-http.exception';
import type { LanguageCode } from '../common/types/language-code.type';
import { ParticipantsService } from '../participants/participants.service';
import {
  STT_TRANSCRIPTION_PROVIDER,
  type SttTranscriptionProvider,
  type SttTranscriptionResult,
} from '../providers/stt/stt-transcription-provider.interface';
import { TRANSLATION_PROVIDER } from '../providers/translation/translation.constants';
import type { TranslationProvider } from '../providers/translation/translation-provider.interface';
import { SessionsService } from '../sessions/sessions.service';
import type {
  AudioChunkInput,
  EndTurnResult,
  StartTurnResult,
} from '../turns/turn.types';
import { TurnsService } from '../turns/turns.service';

const PARTIAL_INTERVAL_BYTES = 2 * 16_000 * 2;

export interface PipelinePartialResult extends SttTranscriptionResult {
  participantId: string;
  sessionId: string;
  turnId: string;
}

type PartialHandler = (result: PipelinePartialResult) => void;

export interface PipelineFinalResult extends EndTurnResult {
  sessionId: string;
}

export interface PipelineTranslationStartedResult {
  sessionId: string;
  turnId: string;
}

export interface PipelineMessageFinalResult {
  createdAt: number;
  latency: {
    endToEndMs: number;
    sttFinalMs: number;
    translationMs: number;
  };
  messageId: string;
  sequence: number;
  sessionId: string;
  sourceLanguage: LanguageCode;
  sourceText: string;
  speaker: {
    displayName: string;
    participantId: string;
  };
  targetLanguage: LanguageCode;
  translatedText: string;
  turnId: string;
}

type FinalHandler = (result: PipelineFinalResult) => void;
type TranslationStartedHandler = (
  result: PipelineTranslationStartedResult,
) => void;
type MessageFinalHandler = (result: PipelineMessageFinalResult) => void;

@Injectable()
export class PipelineService {
  private readonly partialInFlight = new Set<string>();
  private readonly nextPartialAt = new Map<string, number>();
  private partialHandler: PartialHandler = () => undefined;
  private finalHandler: FinalHandler = () => undefined;
  private translationStartedHandler: TranslationStartedHandler = () =>
    undefined;
  private messageFinalHandler: MessageFinalHandler = () => undefined;

  constructor(
    @Inject(STT_TRANSCRIPTION_PROVIDER)
    private readonly sttProvider: SttTranscriptionProvider,
    @Inject(TRANSLATION_PROVIDER)
    private readonly translationProvider: TranslationProvider,
    private readonly participantsService: ParticipantsService,
    private readonly sessionsService: SessionsService,
    private readonly turnsService: TurnsService,
  ) {
    this.turnsService.registerSessionCleanupHandler((turnIds) => {
      for (const turnId of turnIds) {
        this.cleanupPartialState(turnId);
        this.partialInFlight.delete(turnId);
      }
    });
  }

  setPartialHandler(handler: PartialHandler): void {
    this.partialHandler = handler;
  }

  setFinalHandler(handler: FinalHandler): void {
    this.finalHandler = handler;
  }

  setTranslationStartedHandler(handler: TranslationStartedHandler): void {
    this.translationStartedHandler = handler;
  }

  setMessageFinalHandler(handler: MessageFinalHandler): void {
    this.messageFinalHandler = handler;
  }

  startTurn(
    sessionId: string,
    participantId: string,
    audioConfig: unknown,
  ): StartTurnResult {
    const result = this.turnsService.startTurn(
      sessionId,
      participantId,
      audioConfig,
    );
    this.nextPartialAt.set(result.turnId, PARTIAL_INTERVAL_BYTES);
    return result;
  }

  appendAudio(input: AudioChunkInput): void {
    this.turnsService.appendAudio(input);
    void this.maybeTranscribePartial(input);
  }

  async endTurn(
    sessionId: string,
    participantId: string,
    turnId: string,
  ): Promise<EndTurnResult> {
    const ending = this.turnsService.beginTurnEnd(
      sessionId,
      participantId,
      turnId,
    );
    if (ending.duplicate) {
      return ending.result;
    }

    this.cleanupPartialState(turnId);
    let result: EndTurnResult;
    try {
      const transcription = await this.sttProvider.transcribe({
        audio: ending.audio.audio,
        isFinal: true,
        language: ending.audio.language,
        turnId,
      });
      result = this.turnsService.completeTurn(
        turnId,
        transcription.text,
        transcription.backend,
        transcription.providerLatencyMs,
        transcription.lowConfidence,
      );
    } catch (error: unknown) {
      this.turnsService.failTurnProcessing(turnId, extractErrorCode(error));
      throw error;
    }

    this.finalHandler({ ...result, sessionId });
    if (result.text.trim() === '') {
      return result;
    }

    this.translationStartedHandler({ sessionId, turnId });
    try {
      const session = this.sessionsService.getSessionById(sessionId);
      const participant =
        this.participantsService.getRequiredParticipant(participantId);
      const translation = await this.translationProvider.translate({
        context: [],
        glossary: session.glossary,
        requestId: `translation_${turnId}`,
        sessionId,
        sourceLanguage: result.language,
        sourceText: result.text,
        targetLanguage: result.targetLanguage,
        turnId,
      });

      if (this.sessionsService.getSessionById(sessionId).status === 'closed') {
        return result;
      }

      const createdAt = Date.now();
      this.messageFinalHandler({
        createdAt,
        latency: {
          endToEndMs: createdAt - result.startedAt,
          sttFinalMs: result.providerLatencyMs ?? 0,
          translationMs: translation.providerLatencyMs ?? 0,
        },
        messageId: `message_${randomUUID()}`,
        sequence: result.sequence,
        sessionId,
        sourceLanguage: result.language,
        sourceText: result.text,
        speaker: {
          displayName: participant.displayName,
          participantId,
        },
        targetLanguage: result.targetLanguage,
        translatedText: translation.translatedText,
        turnId,
      });
      return result;
    } catch (error: unknown) {
      throw toTranslationError(error);
    }
  }

  cancelTurn(sessionId: string, participantId: string, turnId: string): void {
    this.cleanupPartialState(turnId);
    this.turnsService.cancelTurn(sessionId, participantId, turnId);
  }

  cancelOpenTurnsForParticipant(
    sessionId: string,
    participantId: string,
  ): void {
    this.turnsService.cancelOpenTurnsForParticipant(sessionId, participantId);
  }

  private async maybeTranscribePartial(input: AudioChunkInput): Promise<void> {
    const threshold = this.nextPartialAt.get(input.turnId);
    if (threshold === undefined || this.partialInFlight.has(input.turnId)) {
      return;
    }
    const snapshot = this.turnsService.getPartialSnapshot(
      input.sessionId,
      input.participantId,
      input.turnId,
    );
    if (snapshot === undefined || snapshot.audio.length < threshold) {
      return;
    }

    this.partialInFlight.add(input.turnId);
    this.nextPartialAt.set(input.turnId, threshold + PARTIAL_INTERVAL_BYTES);
    try {
      const result = await this.sttProvider.transcribe({
        audio: snapshot.audio,
        isFinal: false,
        language: snapshot.language,
        turnId: snapshot.turnId,
      });
      if (this.nextPartialAt.has(input.turnId)) {
        this.partialHandler({
          ...result,
          participantId: snapshot.participantId,
          sessionId: snapshot.sessionId,
          turnId: snapshot.turnId,
        });
      }
    } catch {
      // A partial is best-effort. Final STT remains authoritative.
    } finally {
      this.partialInFlight.delete(input.turnId);
    }
  }

  private cleanupPartialState(turnId: string): void {
    this.nextPartialAt.delete(turnId);
  }
}

function extractErrorCode(error: unknown): string {
  if (error instanceof ApiHttpException) {
    const response = error.getResponse();
    if (
      typeof response === 'object' &&
      response !== null &&
      'code' in response &&
      typeof response.code === 'string'
    ) {
      return response.code;
    }
  }
  return 'STT_PROVIDER_ERROR';
}

function toTranslationError(error: unknown): ApiHttpException {
  if (error instanceof ApiHttpException) {
    return error;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('timeout') || message.includes('timed out')) {
    return new ApiHttpException(
      HttpStatus.GATEWAY_TIMEOUT,
      'TRANSLATION_TIMEOUT',
      'The translation provider timed out.',
    );
  }
  return new ApiHttpException(
    HttpStatus.BAD_GATEWAY,
    'TRANSLATION_UNAVAILABLE',
    'The translation provider is unavailable.',
  );
}
