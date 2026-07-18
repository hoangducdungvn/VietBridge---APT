import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { AxiosError } from 'axios';
import { of, throwError } from 'rxjs';
import { RealTranslationProvider } from './real-translation.provider';
import { TranslationInput } from './translation.types';

describe('RealTranslationProvider', () => {
  let provider: RealTranslationProvider;
  let httpService: { post: jest.Mock };

  const baseInput: TranslationInput = {
    context: [
      {
        sourceLanguage: 'vi',
        sourceText: 'Xin chào',
        translatedText: 'Hello',
      },
    ],
    glossary: {
      'dự án Alpha': 'Project Alpha',
    },
    requestId: 'req-1',
    sessionId: 'sess-1',
    sourceLanguage: 'vi',
    sourceText: 'Chúng tôi đang thảo luận về dự án Alpha.',
    targetLanguage: 'en',
    turnId: 'turn-1',
  };

  beforeEach(async () => {
    httpService = {
      post: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealTranslationProvider,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string | number) => {
              if (key === 'TRANSLATION_SERVICE_URL') {
                return 'http://localhost:8000';
              }
              if (key === 'TRANSLATION_TIMEOUT_MS') {
                return 5000;
              }
              return defaultValue;
            }),
          },
        },
        {
          provide: HttpService,
          useValue: httpService,
        },
      ],
    }).compile();

    provider = module.get<RealTranslationProvider>(RealTranslationProvider);
  });

  function createAxiosError(
    message: string,
    options: {
      code?: string;
      status?: number;
      data?: unknown;
    } = {},
  ): AxiosError {
    return {
      isAxiosError: true,
      name: 'AxiosError',
      message,
      code: options.code,
      config: {},
      toJSON: jest.fn(),
      response: options.status
        ? {
            data: options.data ?? { message: 'error' },
            status: options.status,
            statusText: 'Internal Server Error',
            headers: {},
            config: {},
          }
        : undefined,
      request: {},
      status: options.status,
    } as AxiosError;
  }

  it('maps successful Python response to TranslationResult', async () => {
    httpService.post.mockReturnValue(
      of({
        data: {
          translatedText: 'We are discussing Project Alpha.',
          providerLatencyMs: 123,
        },
      }),
    );

    const result = await provider.translate(baseInput);

    expect(httpService.post).toHaveBeenCalledTimes(1);
    expect(httpService.post).toHaveBeenCalledWith(
      'http://localhost:8000/translate',
      {
        sourceText: baseInput.sourceText,
        sourceLanguage: baseInput.sourceLanguage,
        targetLanguage: baseInput.targetLanguage,
        context: baseInput.context,
        glossary: baseInput.glossary,
      },
      expect.objectContaining({
        timeout: 5000,
        headers: {
          'x-request-id': baseInput.requestId,
        },
      }),
    );
    expect(result).toEqual({
      requestId: baseInput.requestId,
      sessionId: baseInput.sessionId,
      turnId: baseInput.turnId,
      sourceLanguage: baseInput.sourceLanguage,
      targetLanguage: baseInput.targetLanguage,
      translatedText: 'We are discussing Project Alpha.',
      providerLatencyMs: 123,
    });
  });

  it('rejects with HTTP status context for 500 response', async () => {
    httpService.post.mockReturnValue(
      throwError(() =>
        createAxiosError('Request failed with status code 500', {
          status: 500,
          data: { error: 'boom' },
        }),
      ),
    );

    await expect(provider.translate(baseInput)).rejects.toThrow(
      /HTTP 500.*req-1/i,
    );
    expect(httpService.post).toHaveBeenCalledTimes(1);
  });

  it('retries once on timeout and preserves requestId header', async () => {
    httpService.post
      .mockReturnValueOnce(
        throwError(() =>
          createAxiosError('timeout of 5000ms exceeded', {
            code: 'ECONNABORTED',
          }),
        ),
      )
      .mockReturnValueOnce(
        of({
          data: {
            translatedText: 'We are discussing Project Alpha.',
            providerLatencyMs: 222,
          },
        }),
      );

    const result = await provider.translate(baseInput);

    expect(httpService.post).toHaveBeenCalledTimes(2);
    expect(httpService.post.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        headers: {
          'x-request-id': baseInput.requestId,
        },
        timeout: 5000,
      }),
    );
    expect(httpService.post.mock.calls[1][2]).toEqual(
      expect.objectContaining({
        headers: {
          'x-request-id': baseInput.requestId,
        },
        timeout: 5000,
      }),
    );
    expect(result).toEqual({
      requestId: baseInput.requestId,
      sessionId: baseInput.sessionId,
      turnId: baseInput.turnId,
      sourceLanguage: baseInput.sourceLanguage,
      targetLanguage: baseInput.targetLanguage,
      translatedText: 'We are discussing Project Alpha.',
      providerLatencyMs: 222,
    });
  });

  it('fails after retry timeout and does not call a third time', async () => {
    httpService.post
      .mockReturnValueOnce(
        throwError(() =>
          createAxiosError('timeout of 5000ms exceeded', {
            code: 'ECONNABORTED',
          }),
        ),
      )
      .mockReturnValueOnce(
        throwError(() =>
          createAxiosError('timeout of 5000ms exceeded', {
            code: 'ECONNABORTED',
          }),
        ),
      );

    await expect(provider.translate(baseInput)).rejects.toThrow(
      /timed out after 5000ms.*req-1/i,
    );
    expect(httpService.post).toHaveBeenCalledTimes(2);
  });

  it('does not retry on non-timeout network error', async () => {
    httpService.post.mockReturnValue(
      throwError(() =>
        createAxiosError('connect ECONNREFUSED 127.0.0.1:8000', {
          code: 'ECONNREFUSED',
        }),
      ),
    );

    await expect(provider.translate(baseInput)).rejects.toThrow(
      /network\/HTTP error for request req-1/i,
    );
    expect(httpService.post).toHaveBeenCalledTimes(1);
  });
});
