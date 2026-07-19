import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AxiosError, AxiosResponse } from 'axios';
import { TranslationProvider } from './translation-provider.interface';
import { TranslationInput, TranslationResult } from './translation.types';
import { protectCriticalValues, restoreCriticalValues } from './critical-tokens';

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
      throw new Error(
        `FPT_API_KEY is missing for translation request ${input.requestId}.`,
      );
    }

    const url = this.configService.get<string>(
      'LLM_URL',
      'https://mkp-api.fptcloud.com/v1/chat/completions',
    );
    const timeoutMs = this.configService.get<number>(
      'TRANSLATION_TIMEOUT_MS',
      8000,
    );
    const model = this.configService.get<string>(
      'LLM_MODEL',
      'Llama-3.3-70B-Instruct',
    );

    // Guardrails ported from translation/src/translator.ts (source of truth):
    // numbers/dates/currency are tokenized so the LLM cannot round or drop
    // them; the marker instruction is only issued when markers exist (an
    // unconditional instruction makes the model hallucinate [[VB_VALUE_n]]
    // into number-free sentences); maxTokens budgets ~10 LLM tokens per
    // marker so counted lists are not truncated mid-output.
    const protectedSource = protectCriticalValues(input.sourceText);
    const sourceWordCount = protectedSource.text.trim().split(/\s+/).length;
    const maxTokens = Math.min(
      400,
      Math.max(48, sourceWordCount * 3 + protectedSource.tokens.length * 10),
    );
    const payload = {
      model,
      messages: [
        {
          role: 'system',
          content: this.buildSystemPrompt(input, protectedSource.tokens.length),
        },
        { role: 'user', content: this.buildUserPrompt(input, protectedSource.text) },
      ],
      max_tokens: maxTokens,
      temperature: 0,
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

      const rawText = response.data.choices?.[0]?.message?.content?.trim();
      if (!rawText) {
        throw new Error('LLM returned an empty or invalid response');
      }
      const translatedText = restoreCriticalValues(
        rawText,
        protectedSource.tokens,
      );
      if (!translatedText) {
        throw new Error('LLM returned an empty or invalid response');
      }

      return this.mapResult(input, translatedText, Date.now() - t0);
    } catch (error) {
      throw this.wrapError(error, input, url, timeoutMs);
    }
  }

  // KEEP IN SYNC with translation/src/prompts.ts (source of truth).
  private buildSystemPrompt(
    input: TranslationInput,
    protectedValueCount: number,
  ): string {
    const langName = { vi: 'Vietnamese', en: 'English' };
    const keepEnglish = [
      'API', 'WebSocket', 'SaaS', 'AI', 'MOU', 'NDA', 'KPI', 'OKR', 'ROI',
      'EBITDA', 'B2B', 'B2C', 'CRM', 'ERP', 'PoC', 'roadmap', 'milestone',
    ];
    const businessGlossary = [
      'revenue = doanh thu',
      'profit = lợi nhuận',
      'cash flow = dòng tiền',
      'market share = thị phần',
      'valuation = định giá',
      'equity = vốn chủ sở hữu/cổ phần (choose by context)',
      'stakeholder = bên liên quan',
      'procurement = thu mua',
      'supply chain = chuỗi cung ứng',
      'compliance = tuân thủ',
      'due diligence = thẩm định chuyên sâu',
      'deliverable = sản phẩm bàn giao',
    ];
    const sessionGlossary = Object.entries(input.glossary)
      .map(([k, v]) => `${k} = ${v}`)
      .join('; ');
    const markerRule =
      protectedValueCount > 0
        ? `\nCopy each [[VB_VALUE_n]] token exactly once in position. Preserve all numbers, dates, currencies, units, signs, and precision; never round or convert.`
        : `\nPreserve all numbers, dates, currencies, units, signs, and precision; never round or convert.`;
    return (
      `Translate ${langName[input.sourceLanguage]} to ${langName[input.targetLanguage]} as a professional business interpreter.\n` +
      `Return only the translation. Preserve meaning, tone, commitments, negation, uncertainty, names, and technical terms; do not summarize or add content.\n` +
      `Keep unchanged: ${keepEnglish.join(', ')}.\n` +
      `Business glossary: ${businessGlossary.join('; ')}.` +
      (sessionGlossary ? `\nSession glossary: ${sessionGlossary}.` : '') +
      markerRule
    );
  }

  private buildUserPrompt(input: TranslationInput, protectedText: string): string {
    const langName = { vi: 'Vietnamese', en: 'English' };
    let prompt = '';
    if (input.context && input.context.length > 0) {
      prompt += `Previous conversation context (for coherence):\n`;
      input.context.forEach((turn) => {
        prompt += `Speaker (${langName[turn.sourceLanguage]}): ${turn.sourceText}\n`;
        prompt += `Translation: ${turn.translatedText}\n`;
      });
      prompt += `\nText to translate:\n`;
    }
    prompt += protectedText;
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
        this.httpService.post<LLMResponse>(url, payload, {
          timeout: timeoutMs,
          headers,
        }),
      );
    } catch (error) {
      if (this.isTimeoutError(error)) {
        this.logger.warn(
          `Translation timeout for request ${requestId}; retrying once with the same requestId.`,
        );
        return await firstValueFrom(
          this.httpService.post<LLMResponse>(url, payload, {
            timeout: timeoutMs,
            headers,
          }),
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
    return (
      typeof error === 'object' && error !== null && 'isAxiosError' in error
    );
  }

  private isTimeoutError(error: unknown): boolean {
    if (!this.isAxiosError(error)) {
      return false;
    }
    return (
      error.code === 'ECONNABORTED' ||
      error.message.toLowerCase().includes('timeout')
    );
  }

  private safeSerialize(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return '[unserializable response body]';
    }
  }
}
