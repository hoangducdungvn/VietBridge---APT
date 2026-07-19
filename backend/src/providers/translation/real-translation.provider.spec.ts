import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { AxiosError } from 'axios';
import { of, throwError } from 'rxjs';
import { RealTranslationProvider } from './real-translation.provider';
import { TranslationInput } from './translation.types';

describe('RealTranslationProvider', () => {
  let provider: RealTranslationProvider;
  let postMock: jest.MockedFunction<
    (url: string, payload: unknown, config: unknown) => unknown
  >;

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
    postMock = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealTranslationProvider,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string | number) => {
              if (key === 'FPT_API_KEY') {
                return 'test-fpt-api-key';
              }
              if (key === 'TRANSLATION_TIMEOUT_MS') {
                return 5000;
              }
              if (key === 'LLM_MODEL') {
                return 'Llama-3.3-70B-Instruct';
              }
              return defaultValue;
            }),
          },
        },
        {
          provide: HttpService,
          useValue: { post: postMock },
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
    postMock.mockReturnValue(
      of({
        data: {
          choices: [
            {
              message: {
                content: 'We are discussing Project Alpha.',
              },
            },
          ],
        },
      }),
    );

    const result = await provider.translate(baseInput);

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledWith(
      'https://mkp-api.fptcloud.com/v1/chat/completions',
      expect.objectContaining({
        model: 'Llama-3.3-70B-Instruct',
        messages: expect.any(Array),
      }),
      expect.objectContaining({
        timeout: 5000,
        headers: {
          Authorization: 'Bearer test-fpt-api-key',
          'Content-Type': 'application/json',
          'x-request-id': baseInput.requestId,
        },
      }),
    );
    const { providerLatencyMs, ...resultWithoutLatency } = result;
    expect(resultWithoutLatency).toEqual({
      requestId: baseInput.requestId,
      sessionId: baseInput.sessionId,
      turnId: baseInput.turnId,
      sourceLanguage: baseInput.sourceLanguage,
      targetLanguage: baseInput.targetLanguage,
      translatedText: 'We are discussing Project Alpha.',
    });
    expect(typeof providerLatencyMs).toBe('number');
  });

  it('rejects with HTTP status context for 500 response', async () => {
    postMock.mockReturnValue(
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
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it('retries once on timeout and preserves requestId header', async () => {
    postMock
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
            choices: [
              {
                message: {
                  content: 'We are discussing Project Alpha.',
                },
              },
            ],
          },
        }),
      );

    const result = await provider.translate(baseInput);

    expect(postMock).toHaveBeenCalledTimes(2);
    expect(postMock.mock.calls[0][0]).toEqual(
      'https://mkp-api.fptcloud.com/v1/chat/completions',
    );
    expect(postMock.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer test-fpt-api-key',
          'Content-Type': 'application/json',
          'x-request-id': baseInput.requestId,
        },
        timeout: 5000,
      }),
    );
    expect(postMock.mock.calls[1][0]).toEqual(
      'https://mkp-api.fptcloud.com/v1/chat/completions',
    );
    expect(postMock.mock.calls[1][2]).toEqual(
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer test-fpt-api-key',
          'Content-Type': 'application/json',
          'x-request-id': baseInput.requestId,
        },
        timeout: 5000,
      }),
    );
    const { providerLatencyMs, ...resultWithoutLatency } = result;
    expect(resultWithoutLatency).toEqual({
      requestId: baseInput.requestId,
      sessionId: baseInput.sessionId,
      turnId: baseInput.turnId,
      sourceLanguage: baseInput.sourceLanguage,
      targetLanguage: baseInput.targetLanguage,
      translatedText: 'We are discussing Project Alpha.',
    });
    expect(typeof providerLatencyMs).toBe('number');
  });

  it('fails after retry timeout and does not call a third time', async () => {
    postMock
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
    expect(postMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry on non-timeout network error', async () => {
    postMock.mockReturnValue(
      throwError(() =>
        createAxiosError('connect ECONNREFUSED 127.0.0.1:8000', {
          code: 'ECONNREFUSED',
        }),
      ),
    );

    await expect(provider.translate(baseInput)).rejects.toThrow(
      /network\/HTTP error for request req-1/i,
    );
    expect(postMock).toHaveBeenCalledTimes(1);
  });
});
