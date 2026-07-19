import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiHttpException } from '../../common/errors/api-http.exception';
import type {
  SttTranscriptionInput,
  SttTranscriptionProvider,
  SttTranscriptionResult,
} from './stt-transcription-provider.interface';

@Injectable()
export class RemoteSttTranscriptionProvider implements SttTranscriptionProvider {
  private readonly logger = new Logger(RemoteSttTranscriptionProvider.name);

  constructor(private readonly configService: ConfigService) {}

  async transcribe(
    input: SttTranscriptionInput,
  ): Promise<SttTranscriptionResult> {
    const baseUrl = this.configService.get<string>(
      'STT_BASE_URL',
      'http://localhost:8001',
    );
    const timeoutMs = this.configService.get<number>(
      input.isFinal ? 'STT_FINAL_TIMEOUT_MS' : 'STT_START_TIMEOUT_MS',
      input.isFinal ? 15_000 : 5000,
    );
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(input.audio)], {
        type: 'application/octet-stream',
      }),
      `${input.turnId}.pcm`,
    );
    form.append('utterance_id', input.turnId);
    form.append('language_hint', input.language);
    form.append('is_final', String(input.isFinal));

    try {
      const response = await fetch(`${baseUrl}/v1/transcribe`, {
        body: form,
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = parseJson(await response.text());
      if (!response.ok || !isSttResponse(body) || body.error !== undefined) {
        throw providerError(
          'STT_PROVIDER_ERROR',
          readProviderError(body) ??
            `The STT provider returned an invalid response (HTTP ${response.status}).`,
        );
      }
      const eou = parseEou(body.eou);
      return {
        backend: body.backend,
        ...(eou === undefined ? {} : { eou }),
        language:
          body.language === 'vi' || body.language === 'en'
            ? body.language
            : input.language,
        lowConfidence: body.low_confidence,
        providerLatencyMs: body.asr_latency_ms,
        text: body.text,
      };
    } catch (error: unknown) {
      if (error instanceof ApiHttpException) {
        throw error;
      }
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        throw providerError('STT_TIMEOUT', 'The STT provider timed out.');
      }
      this.logger.error(
        `Unable to reach STT provider at ${baseUrl}: ${formatError(error)}`,
      );
      throw providerError(
        'STT_PROVIDER_UNAVAILABLE',
        'The STT provider is unavailable.',
      );
    }
  }
}

interface SttHttpResponse {
  asr_latency_ms: number;
  backend: string;
  eou?: unknown;
  error?: unknown;
  language: string;
  low_confidence: boolean;
  text: string;
}

function parseEou(value: unknown): SttTranscriptionResult['eou'] {
  if (
    !isRecord(value) ||
    typeof value.is_endpoint !== 'boolean' ||
    typeof value.reason !== 'string' ||
    typeof value.speech_ms !== 'number' ||
    typeof value.trailing_silence_ms !== 'number' ||
    typeof value.duration_ms !== 'number'
  ) {
    return undefined;
  }
  return {
    durationMs: value.duration_ms,
    isEndpoint: value.is_endpoint,
    reason: value.reason,
    speechMs: value.speech_ms,
    trailingSilenceMs: value.trailing_silence_ms,
  };
}

function isSttResponse(value: unknown): value is SttHttpResponse {
  return (
    isRecord(value) &&
    typeof value.text === 'string' &&
    typeof value.language === 'string' &&
    typeof value.backend === 'string' &&
    typeof value.asr_latency_ms === 'number' &&
    typeof value.low_confidence === 'boolean'
  );
}

function readProviderError(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.error)) {
    return undefined;
  }
  return typeof value.error.message === 'string'
    ? value.error.message
    : undefined;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function formatError(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : 'Unknown network error';
}

function providerError(code: string, message: string): ApiHttpException {
  return new ApiHttpException(HttpStatus.BAD_GATEWAY, code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
