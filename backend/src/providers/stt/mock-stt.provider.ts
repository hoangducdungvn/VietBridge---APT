import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StreamingSttProvider } from './streaming-stt-provider.interface';
import {
  SttEventHandlers,
  SttFinalResult,
  SttPartialResult,
  SttSendAudioInput,
  SttStartTurnInput,
  SttTurnReference,
} from './stt.types';

interface MockSttTurnState {
  language: SttStartTurnInput['language'];
  participantId: string;
  sessionId: string;
  turnId: string;
}

@Injectable()
export class MockSttProvider implements StreamingSttProvider {
  private readonly turnStateByTurnId = new Map<string, MockSttTurnState>();
  private handlers?: SttEventHandlers;

  constructor(private readonly configService: ConfigService) {}

  setEventHandlers(handlers: SttEventHandlers): void {
    this.handlers = handlers;
  }

  async startTurn(input: SttStartTurnInput): Promise<void> {
    this.turnStateByTurnId.set(input.turnId, {
      language: input.language,
      participantId: input.participantId,
      sessionId: input.sessionId,
      turnId: input.turnId,
    });
  }

  async sendAudio(input: SttSendAudioInput): Promise<void> {
    const delayMs = Number(
      this.configService.get<string | number>('STT_MOCK_DELAY_MS') ?? 200,
    );

    await new Promise((resolve) => setTimeout(resolve, delayMs));

    const state = this.turnStateByTurnId.get(input.turnId);
    if (!state || !this.handlers?.onPartial) {
      return;
    }

    const partialResult: SttPartialResult = {
      confidence: 0.5,
      providerLatencyMs: delayMs,
      sessionId: state.sessionId,
      text: `[MOCK-PARTIAL] chunk-${input.sequence}`,
      turnId: state.turnId,
    };

    this.handlers.onPartial(partialResult);
  }

  async finishTurn(input: SttTurnReference): Promise<void> {
    const state = this.turnStateByTurnId.get(input.turnId);

    if (!state) {
      return;
    }

    if (input.turnId.includes('__ERROR__')) {
      this.handlers?.onError({
        code: 'MOCK_STT_ERROR',
        message: `Mock STT error for turn ${input.turnId}`,
        recoverable: false,
        sessionId: state.sessionId,
        turnId: state.turnId,
      });
      this.turnStateByTurnId.delete(input.turnId);
      return;
    }

    const finalResult: SttFinalResult = {
      confidence: 1,
      language: state.language,
      providerLatencyMs: Number(
        this.configService.get<string | number>('STT_MOCK_DELAY_MS') ?? 200,
      ),
      sessionId: state.sessionId,
      text: `[MOCK-FINAL] turn-${state.turnId}`,
      turnId: state.turnId,
    };

    this.handlers?.onFinal(finalResult);
    this.turnStateByTurnId.delete(input.turnId);
  }

  async cancelTurn(input: SttTurnReference): Promise<void> {
    this.turnStateByTurnId.delete(input.turnId);
  }

  async closeSession(sessionId: string): Promise<void> {
    for (const [turnId, state] of this.turnStateByTurnId.entries()) {
      if (state.sessionId === sessionId) {
        this.turnStateByTurnId.delete(turnId);
      }
    }

    this.handlers?.onDisconnect({ sessionId });
  }
}
