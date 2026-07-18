import { Inject, Injectable } from '@nestjs/common';
import { ApiHttpException } from '../common/errors/api-http.exception';
import {
  STT_TRANSCRIPTION_PROVIDER,
  type SttTranscriptionProvider,
  type SttTranscriptionResult,
} from '../providers/stt/stt-transcription-provider.interface';
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

@Injectable()
export class PipelineService {
  private readonly partialInFlight = new Set<string>();
  private readonly nextPartialAt = new Map<string, number>();
  private partialHandler: PartialHandler = () => undefined;

  constructor(
    @Inject(STT_TRANSCRIPTION_PROVIDER)
    private readonly sttProvider: SttTranscriptionProvider,
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
    try {
      const transcription = await this.sttProvider.transcribe({
        audio: ending.audio.audio,
        isFinal: true,
        language: ending.audio.language,
        turnId,
      });
      return this.turnsService.completeTurn(
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
