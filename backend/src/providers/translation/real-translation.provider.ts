import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AxiosError, AxiosResponse } from 'axios';
import { TranslationProvider } from './translation-provider.interface';
import {
  TranslationInput,
  TranslationResult,
} from './translation.types';

interface PythonTranslationResponse {
  translatedText: string;
  providerLatencyMs?: number;
}

@Injectable()
export class RealTranslationProvider implements TranslationProvider {
  private readonly logger = new Logger(RealTranslationProvider.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {}

  async translate(input: TranslationInput): Promise<TranslationResult> {
    const serviceUrl = this.configService.get<string>(
      'TRANSLATION_SERVICE_URL',
      'http://localhost:8000',
    );
    const timeoutMs = this.configService.get<number>('TRANSLATION_TIMEOUT_MS', 5000);

    if (!serviceUrl) {
      throw new Error(
        `Translation service URL is missing for request ${input.requestId}.`,
      );
    }

    const payload = {
      sourceText: input.sourceText,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      context: [...input.context],
      glossary: { ...input.glossary },
    };

    try {
      const response = await this.postWithRetry(
        serviceUrl,
        payload,
        timeoutMs,
        input.requestId,
      );

      return this.mapResult(input, response.data);
    } catch (error) {
      throw this.wrapError(error, input, serviceUrl, timeoutMs);
    }
  }

  private async postWithRetry(
    serviceUrl: string,
    payload: Record<string, unknown>,
    timeoutMs: number,
    requestId: string,
  ): Promise<AxiosResponse<PythonTranslationResponse>> {
    try {
      return await firstValueFrom(
        this.httpService.post<PythonTranslationResponse>(
          `${serviceUrl}/translate`,
          payload,
          {
            timeout: timeoutMs,
            headers: {
              'x-request-id': requestId,
            },
          },
        ),
      );
    } catch (error) {
      if (this.isTimeoutError(error)) {
        this.logger.warn(
          `Translation timeout for request ${requestId}; retrying once with the same requestId.`,
        );
        return await firstValueFrom(
          this.httpService.post<PythonTranslationResponse>(
            `${serviceUrl}/translate`,
            payload,
            {
              timeout: timeoutMs,
              headers: {
                'x-request-id': requestId,
              },
            },
          ),
        );
      }

      throw error;
    }
  }

  private mapResult(
    input: TranslationInput,
    response: PythonTranslationResponse,
  ): TranslationResult {
    return {
      requestId: input.requestId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      translatedText: response.translatedText,
      providerLatencyMs: response.providerLatencyMs,
    };
  }

  private wrapError(
    error: unknown,
    input: TranslationInput,
    serviceUrl: string,
    timeoutMs: number,
  ): Error {
    if (this.isAxiosError(error)) {
      const status = error.response?.status;
      const responseBody = error.response?.data;

      if (status) {
        return new Error(
          `Translation service responded with HTTP ${status} for request ${input.requestId} to ${serviceUrl}/translate. Response: ${this.safeSerialize(
            responseBody,
          )}`,
        );
      }

      if (this.isTimeoutError(error)) {
        return new Error(
          `Translation service timed out after ${timeoutMs}ms for request ${input.requestId} to ${serviceUrl}/translate.`,
        );
      }

      return new Error(
        `Translation service network/HTTP error for request ${input.requestId} to ${serviceUrl}/translate: ${
          error.message
        }`,
      );
    }

    if (error instanceof Error) {
      return new Error(
        `Unexpected translation error for request ${input.requestId} to ${serviceUrl}/translate: ${error.message}`,
      );
    }

    return new Error(
      `Unexpected non-error translation failure for request ${input.requestId} to ${serviceUrl}/translate.`,
    );
  }

  private isAxiosError(error: unknown): error is AxiosError {
    return typeof error === 'object' && error !== null && 'isAxiosError' in error;
  }

  private isTimeoutError(error: unknown): boolean {
    if (!this.isAxiosError(error)) {
      return false;
    }

    return error.code === 'ECONNABORTED' || error.message.toLowerCase().includes('timeout');
  }

  private safeSerialize(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return '[unserializable response body]';
    }
  }
}
