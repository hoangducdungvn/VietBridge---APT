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

interface LLMResponse {
  choices?: { message?: { content?: string } }[];
}

@Injectable()
export class RealTranslationProvider implements TranslationProvider {
  private readonly logger = new Logger(RealTranslationProvider.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {}

  async translate(input: TranslationInput): Promise<TranslationResult> {
    const apiKey = this.configService.get<string>('FPT_API_KEY');
    if (!apiKey) {
      throw new Error(`FPT_API_KEY is missing for translation request ${input.requestId}.`);
    }

    const url = 'https://mkp-api.fptcloud.com/v1/chat/completions';
    const timeoutMs = this.configService.get<number>('TRANSLATION_TIMEOUT_MS', 8000);
    const model = this.configService.get<string>('LLM_MODEL', 'Llama-3.3-70B-Instruct');

    const prompt = this.buildPrompt(input);
    const payload = {
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 400,
      temperature: 0.1,
    };

    const t0 = Date.now();
    try {
      const response = await this.postWithRetry(
        url,
        apiKey,
        payload,
        timeoutMs,
        input.requestId,
      );

      const translatedText = response.data.choices?.[0]?.message?.content?.trim();
      if (!translatedText) {
         throw new Error('LLM returned an empty or invalid response');
      }

      return this.mapResult(input, translatedText, Date.now() - t0);
    } catch (error) {
      throw this.wrapError(error, input, url, timeoutMs);
    }
  }

  private buildPrompt(input: TranslationInput): string {
    const langName = { vi: 'Vietnamese', en: 'English' };
    let prompt = `You are a professional interpreter for a Vietnamese-English business meeting. Translate the following ${langName[input.sourceLanguage]} text to ${langName[input.targetLanguage]}.\nRules:\n`;
    
    const glossaryEntries = Object.entries(input.glossary);
    if (glossaryEntries.length > 0) {
        prompt += `- Use the following glossary: ${glossaryEntries.map(([k, v]) => `${k} -> ${v}`).join(', ')}\n`;
    } else {
        prompt += `- Keep business/technical terms commonly used in English (API, WebSocket, deploy, ...) in English\n`;
    }
    
    prompt += `- Keep proper nouns, numbers, and currency amounts exactly as spoken
- Maintain the speaker's natural tone; do not add or omit content
- Return ONLY the translated text, no explanations\n\n`;

    if (input.context && input.context.length > 0) {
        prompt += `Previous conversation context:\n`;
        input.context.forEach(turn => {
            prompt += `Speaker (${langName[turn.sourceLanguage]}): ${turn.sourceText}\n`;
            prompt += `Translation: ${turn.translatedText}\n`;
        });
        prompt += `\n`;
    }

    prompt += `Text to translate: ${input.sourceText}`;
    return prompt;
  }

  private async postWithRetry(
    url: string,
    apiKey: string,
    payload: Record<string, unknown>,
    timeoutMs: number,
    requestId: string,
  ): Promise<AxiosResponse<LLMResponse>> {
    const headers = {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'x-request-id': requestId,
    };
    try {
      return await firstValueFrom(
        this.httpService.post<LLMResponse>(url, payload, { timeout: timeoutMs, headers }),
      );
    } catch (error) {
      if (this.isTimeoutError(error)) {
        this.logger.warn(
          `Translation timeout for request ${requestId}; retrying once with the same requestId.`,
        );
        return await firstValueFrom(
          this.httpService.post<LLMResponse>(url, payload, { timeout: timeoutMs, headers }),
        );
      }
      throw error;
    }
  }

  private mapResult(
    input: TranslationInput,
    translatedText: string,
    latencyMs: number,
  ): TranslationResult {
    return {
      requestId: input.requestId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      translatedText,
      providerLatencyMs: latencyMs,
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
          `Translation service responded with HTTP ${status} for request ${input.requestId}. Response: ${this.safeSerialize(
            responseBody,
          )}`,
        );
      }

      if (this.isTimeoutError(error)) {
        return new Error(
          `Translation service timed out after ${timeoutMs}ms for request ${input.requestId}.`,
        );
      }

      return new Error(
        `Translation service network/HTTP error for request ${input.requestId}: ${error.message}`,
      );
    }

    if (error instanceof Error) {
      return new Error(
        `Unexpected translation error for request ${input.requestId}: ${error.message}`,
      );
    }

    return new Error(
      `Unexpected non-error translation failure for request ${input.requestId}.`,
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
