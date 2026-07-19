import { HttpException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RemoteSttTranscriptionProvider } from './remote-stt-transcription.provider';

describe('RemoteSttTranscriptionProvider', () => {
  afterEach(() => jest.restoreAllMocks());

  it('maps STT EOU metadata without exposing the provider wire shape', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          asr_latency_ms: 180,
          backend: 'fpt_final',
          eou: {
            duration_ms: 3200,
            is_endpoint: true,
            reason: 'client_final',
            speech_ms: 1680,
            trailing_silence_ms: 1480,
          },
          language: 'vi',
          low_confidence: false,
          text: 'Xin chào, tôi đang trình bày một câu dài.',
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 },
      ),
    );
    const provider = createProvider();

    const result = await provider.transcribe({
      audio: Buffer.alloc(3200),
      isFinal: true,
      language: 'vi',
      turnId: 'turn-eou',
    });

    expect(result.eou).toEqual({
      durationMs: 3200,
      isEndpoint: true,
      reason: 'client_final',
      speechMs: 1680,
      trailingSilenceMs: 1480,
    });
  });

  it('maps a non-JSON upstream response to a provider error', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('Bad Gateway', { status: 502 }));

    await expectProviderCode(
      createProvider().transcribe(finalInput()),
      'STT_PROVIDER_ERROR',
    );
  });

  it('maps network failures to provider unavailable and logs the cause', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new TypeError('fetch failed'));
    const logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expectProviderCode(
      createProvider().transcribe(finalInput()),
      'STT_PROVIDER_UNAVAILABLE',
    );
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('TypeError: fetch failed'),
    );
  });

  it('maps aborted upstream requests to an STT timeout', async () => {
    const timeout = new Error('request timed out');
    timeout.name = 'TimeoutError';
    jest.spyOn(global, 'fetch').mockRejectedValue(timeout);

    await expectProviderCode(
      createProvider().transcribe(finalInput()),
      'STT_TIMEOUT',
    );
  });
});

function createProvider(): RemoteSttTranscriptionProvider {
  const configService = {
    get: jest.fn((key: string, fallback: unknown) => {
      if (key === 'STT_BASE_URL') return 'https://stt.example.test';
      if (key === 'STT_FINAL_TIMEOUT_MS') return 15_000;
      return fallback;
    }),
  };
  return new RemoteSttTranscriptionProvider(
    configService as unknown as ConfigService,
  );
}

function finalInput() {
  return {
    audio: Buffer.alloc(3200),
    isFinal: true,
    language: 'vi' as const,
    turnId: 'turn-final',
  };
}

async function expectProviderCode(
  promise: Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected provider error ${expectedCode}.`);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(HttpException);
    if (error instanceof HttpException) {
      expect(error.getResponse()).toEqual(
        expect.objectContaining({ code: expectedCode }),
      );
    }
  }
}
