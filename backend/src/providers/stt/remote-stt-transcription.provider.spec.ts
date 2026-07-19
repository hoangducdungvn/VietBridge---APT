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
    const configService = {
      get: jest.fn((key: string, fallback: unknown) => {
        if (key === 'STT_BASE_URL') return 'https://stt.example.test';
        if (key === 'STT_FINAL_TIMEOUT_MS') return 10_000;
        return fallback;
      }),
    };
    const provider = new RemoteSttTranscriptionProvider(
      configService as unknown as ConfigService,
    );

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
});
