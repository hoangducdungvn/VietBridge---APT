import { HttpException } from '@nestjs/common';
import type { ParticipantsService } from '../participants/participants.service';
import type { SttTranscriptionProvider } from '../providers/stt/stt-transcription-provider.interface';
import type { TranslationProvider } from '../providers/translation/translation-provider.interface';
import type { SessionsService } from '../sessions/sessions.service';
import type { EndTurnResult } from '../turns/turn.types';
import type { TurnsService } from '../turns/turns.service';
import { PipelineService } from './pipeline.service';

const FINAL_RESULT: EndTurnResult = {
  backend: 'fpt',
  duplicate: false,
  language: 'vi',
  lowConfidence: false,
  participantId: 'participant-host',
  providerLatencyMs: 420,
  sequence: 3,
  startedAt: 1_000,
  targetLanguage: 'en',
  text: 'Xin chào',
  turnId: 'turn-1',
};

describe('PipelineService translation orchestration', () => {
  let service: PipelineService;
  let sttProvider: jest.Mocked<SttTranscriptionProvider>;
  let translationProvider: jest.Mocked<TranslationProvider>;
  let turnsService: {
    beginTurnEnd: jest.Mock;
    completeTurn: jest.Mock;
    registerSessionCleanupHandler: jest.Mock;
  };
  let sessionsService: { getSessionById: jest.Mock };
  let participantsService: { getRequiredParticipant: jest.Mock };

  beforeEach(() => {
    sttProvider = { transcribe: jest.fn() };
    translationProvider = { translate: jest.fn() };
    turnsService = {
      beginTurnEnd: jest.fn().mockReturnValue({
        audio: {
          audio: Buffer.alloc(320),
          language: 'vi',
          participantId: 'participant-host',
          sessionId: 'session-1',
          turnId: 'turn-1',
        },
        duplicate: false,
      }),
      completeTurn: jest.fn().mockReturnValue(FINAL_RESULT),
      registerSessionCleanupHandler: jest.fn(),
    };
    sessionsService = {
      getSessionById: jest.fn().mockReturnValue({
        glossary: { VietBridge: 'VietBridge' },
        status: 'active',
      }),
    };
    participantsService = {
      getRequiredParticipant: jest.fn().mockReturnValue({
        displayName: 'Duong',
        participantId: 'participant-host',
      }),
    };

    service = new PipelineService(
      sttProvider,
      translationProvider,
      participantsService as unknown as ParticipantsService,
      sessionsService as unknown as SessionsService,
      turnsService as unknown as TurnsService,
    );
  });

  it('broadcasts final STT before translating and creates one bilingual message', async () => {
    const order: string[] = [];
    sttProvider.transcribe.mockResolvedValue({
      backend: 'fpt',
      language: 'vi',
      lowConfidence: false,
      providerLatencyMs: 420,
      text: 'Xin chào',
    });
    translationProvider.translate.mockImplementation(() => {
      order.push('provider.translate');
      return Promise.resolve({
        providerLatencyMs: 230,
        requestId: 'translation_turn-1',
        sessionId: 'session-1',
        sourceLanguage: 'vi',
        targetLanguage: 'en',
        translatedText: 'Hello',
        turnId: 'turn-1',
      });
    });
    const finalHandler = jest.fn(() => order.push('stt.final'));
    const startedHandler = jest.fn(() => order.push('translation.started'));
    const messageHandler = jest.fn(() => order.push('message.final'));
    service.setFinalHandler(finalHandler);
    service.setTranslationStartedHandler(startedHandler);
    service.setMessageFinalHandler(messageHandler);

    await service.endTurn('session-1', 'participant-host', 'turn-1');

    expect(order).toEqual([
      'stt.final',
      'translation.started',
      'provider.translate',
      'message.final',
    ]);
    expect(translationProvider.translate.mock.calls).toEqual([
      [
        {
          context: [],
          glossary: { VietBridge: 'VietBridge' },
          requestId: 'translation_turn-1',
          sessionId: 'session-1',
          sourceLanguage: 'vi',
          sourceText: 'Xin chào',
          targetLanguage: 'en',
          turnId: 'turn-1',
        },
      ],
    ]);
    expect(messageHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        sequence: 3,
        sourceLanguage: 'vi',
        sourceText: 'Xin chào',
        speaker: {
          displayName: 'Duong',
          participantId: 'participant-host',
        },
        targetLanguage: 'en',
        translatedText: 'Hello',
      }),
    );
  });

  it('does not translate or emit again for a duplicate turn end', async () => {
    turnsService.beginTurnEnd.mockReturnValue({
      duplicate: true,
      result: { ...FINAL_RESULT, duplicate: true },
    });
    const finalHandler = jest.fn();
    const messageHandler = jest.fn();
    service.setFinalHandler(finalHandler);
    service.setMessageFinalHandler(messageHandler);

    const result = await service.endTurn(
      'session-1',
      'participant-host',
      'turn-1',
    );

    expect(result.duplicate).toBe(true);
    expect(sttProvider.transcribe.mock.calls).toHaveLength(0);
    expect(translationProvider.translate.mock.calls).toHaveLength(0);
    expect(finalHandler).not.toHaveBeenCalled();
    expect(messageHandler).not.toHaveBeenCalled();
  });

  it('keeps final STT and maps translation timeouts to a recoverable code', async () => {
    sttProvider.transcribe.mockResolvedValue({
      backend: 'fpt',
      language: 'vi',
      lowConfidence: false,
      providerLatencyMs: 420,
      text: 'Xin chào',
    });
    translationProvider.translate.mockRejectedValue(
      new Error('Translation timed out after 10000ms.'),
    );
    const finalHandler = jest.fn();
    service.setFinalHandler(finalHandler);

    try {
      await service.endTurn('session-1', 'participant-host', 'turn-1');
      throw new Error('Expected translation timeout.');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(HttpException);
      if (error instanceof HttpException) {
        expect(error.getResponse()).toEqual(
          expect.objectContaining({ code: 'TRANSLATION_TIMEOUT' }),
        );
      }
    }
    expect(finalHandler).toHaveBeenCalledTimes(1);
  });
});
