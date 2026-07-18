import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MockTranslationProvider } from './mock-translation.provider';
import { TranslationInput } from './translation.types';

describe('MockTranslationProvider', () => {
  let provider: MockTranslationProvider;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MockTranslationProvider,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'MOCK_TRANSLATION_DELAY_MS') return 300;
              if (key === 'TRANSLATION_TIMEOUT_MS') return 5000;
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    provider = module.get<MockTranslationProvider>(MockTranslationProvider);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should return translation result for happy path with delay', async () => {
    jest.useFakeTimers();
    const input: TranslationInput = {
      context: [],
      glossary: {},
      requestId: 'req-1',
      sessionId: 'sess-1',
      sourceLanguage: 'vi',
      sourceText: 'Xin chào',
      targetLanguage: 'en',
      turnId: 'turn-1',
    };

    const promise = provider.translate(input);
    
    // Fast-forward time
    jest.advanceTimersByTime(300);

    const result = await promise;

    expect(result).toEqual({
      providerLatencyMs: 300,
      requestId: 'req-1',
      sessionId: 'sess-1',
      sourceLanguage: 'vi',
      targetLanguage: 'en',
      translatedText: '[MOCK-en] Xin chào',
      turnId: 'turn-1',
    });
  });

  it('should use custom delay from MOCK_TRANSLATION_DELAY_MS config', async () => {
    jest.useFakeTimers();
    jest.spyOn(configService, 'get').mockImplementation((key: string) => {
      if (key === 'MOCK_TRANSLATION_DELAY_MS') return 50;
      if (key === 'TRANSLATION_TIMEOUT_MS') return 5000;
      return undefined;
    });

    const input: TranslationInput = {
      context: [],
      glossary: {},
      requestId: 'req-2',
      sessionId: 'sess-1',
      sourceLanguage: 'vi',
      sourceText: 'Xin chào',
      targetLanguage: 'en',
      turnId: 'turn-1',
    };

    const promise = provider.translate(input);
    
    // Fast-forward time by 50ms
    jest.advanceTimersByTime(50);

    const result = await promise;

    expect(result.providerLatencyMs).toBe(50);
    expect(result.translatedText).toBe('[MOCK-en] Xin chào');
  });

  it('should throw an error when sourceText contains __ERROR__', async () => {
    jest.useFakeTimers();
    const input: TranslationInput = {
      context: [],
      glossary: {},
      requestId: 'req-1',
      sessionId: 'sess-1',
      sourceLanguage: 'vi',
      sourceText: 'Xin chào __ERROR__',
      targetLanguage: 'en',
      turnId: 'turn-1',
    };

    const promise = provider.translate(input);
    jest.advanceTimersByTime(300);

    await expect(promise).rejects.toThrow('Mock translation error');
  });

  it('should not resolve before TRANSLATION_TIMEOUT_MS when sourceText contains __TIMEOUT__', async () => {
    jest.useFakeTimers();
    const input: TranslationInput = {
      context: [],
      glossary: {},
      requestId: 'req-1',
      sessionId: 'sess-1',
      sourceLanguage: 'vi',
      sourceText: 'Xin chào __TIMEOUT__',
      targetLanguage: 'en',
      turnId: 'turn-1',
    };

    const promise = provider.translate(input);

    let isResolved = false;
    promise.then(() => {
      isResolved = true;
    });

    // Fast-forward by TRANSLATION_TIMEOUT_MS (5000ms), should not be resolved yet
    await jest.advanceTimersByTimeAsync(5000);
    expect(isResolved).toBe(false);

    // Fast-forward past the extra delay (1000ms), now it should resolve
    await jest.advanceTimersByTimeAsync(1000);
    expect(isResolved).toBe(true);

    const result = await promise;
    expect(result.translatedText).toBe('[MOCK-en] Xin chào __TIMEOUT__');
  });
});
