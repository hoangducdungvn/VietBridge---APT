import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { MockSttProvider } from './mock-stt.provider';
import { SttStartTurnInput } from './stt.types';

describe('MockSttProvider', () => {
  let provider: MockSttProvider;
  let configService: ConfigService;

  const mockHandlers = {
    onPartial: jest.fn(),
    onFinal: jest.fn(),
    onError: jest.fn(),
    onDisconnect: jest.fn(),
  };

  const baseStartTurnInput: SttStartTurnInput = {
    audioConfig: {
      channels: 1,
      codec: 'pcm_s16le',
      sampleRate: 16_000,
    },
    language: 'vi',
    participantId: 'participant-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MockSttProvider,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'STT_MOCK_DELAY_MS') return 200;
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    provider = module.get<MockSttProvider>(MockSttProvider);
    configService = module.get<ConfigService>(ConfigService);
    provider.setEventHandlers(mockHandlers);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('startTurn rồi sendAudio emits partial result after configured delay', async () => {
    jest.useFakeTimers();
    await provider.startTurn(baseStartTurnInput);

    const promise = provider.sendAudio({
      audio: Buffer.from('fake-audio'),
      sequence: 7,
      sessionId: baseStartTurnInput.sessionId,
      turnId: baseStartTurnInput.turnId,
    });

    await jest.advanceTimersByTimeAsync(200);
    await promise;

    expect(mockHandlers.onPartial).toHaveBeenCalledTimes(1);
    expect(mockHandlers.onPartial).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: baseStartTurnInput.sessionId,
        turnId: baseStartTurnInput.turnId,
        text: '[MOCK-PARTIAL] chunk-7',
      }),
    );
  });

  it('finishTurn happy path emits final result with language from startTurn', async () => {
    await provider.startTurn(baseStartTurnInput);

    await provider.finishTurn({
      sessionId: baseStartTurnInput.sessionId,
      turnId: baseStartTurnInput.turnId,
    });

    expect(mockHandlers.onFinal).toHaveBeenCalledTimes(1);
    expect(mockHandlers.onFinal).toHaveBeenCalledWith(
      expect.objectContaining({
        language: baseStartTurnInput.language,
        sessionId: baseStartTurnInput.sessionId,
        text: `[MOCK-FINAL] turn-${baseStartTurnInput.turnId}`,
        turnId: baseStartTurnInput.turnId,
      }),
    );
  });

  it('finishTurn with __ERROR__ turnId emits error instead of final', async () => {
    await provider.startTurn({
      ...baseStartTurnInput,
      turnId: 'turn-__ERROR__-1',
    });

    await provider.finishTurn({
      sessionId: baseStartTurnInput.sessionId,
      turnId: 'turn-__ERROR__-1',
    });

    expect(mockHandlers.onError).toHaveBeenCalledTimes(1);
    expect(mockHandlers.onError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'MOCK_STT_ERROR',
        recoverable: false,
        sessionId: baseStartTurnInput.sessionId,
        turnId: 'turn-__ERROR__-1',
      }),
    );
    expect(mockHandlers.onFinal).not.toHaveBeenCalled();
  });

  it('cancelTurn clears turn state so later finishTurn returns early', async () => {
    await provider.startTurn(baseStartTurnInput);

    await provider.cancelTurn({
      sessionId: baseStartTurnInput.sessionId,
      turnId: baseStartTurnInput.turnId,
    });

    await provider.finishTurn({
      sessionId: baseStartTurnInput.sessionId,
      turnId: baseStartTurnInput.turnId,
    });

    expect(mockHandlers.onPartial).not.toHaveBeenCalled();
    expect(mockHandlers.onFinal).not.toHaveBeenCalled();
    expect(mockHandlers.onError).not.toHaveBeenCalled();
    expect(mockHandlers.onDisconnect).not.toHaveBeenCalled();
  });

  it('closeSession removes all turns in session and emits disconnect once', async () => {
    await provider.startTurn({
      ...baseStartTurnInput,
      turnId: 'turn-1',
    });
    await provider.startTurn({
      ...baseStartTurnInput,
      turnId: 'turn-2',
    });

    await provider.closeSession(baseStartTurnInput.sessionId);

    expect(mockHandlers.onDisconnect).toHaveBeenCalledTimes(1);
    expect(mockHandlers.onDisconnect).toHaveBeenCalledWith({
      sessionId: baseStartTurnInput.sessionId,
    });
  });
});
