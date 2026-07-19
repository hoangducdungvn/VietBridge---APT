import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TranslationProvider } from './translation-provider.interface';
import { TranslationInput, TranslationResult } from './translation.types';

@Injectable()
export class MockTranslationProvider implements TranslationProvider {
  constructor(private readonly configService: ConfigService) {}

  async translate(input: TranslationInput): Promise<TranslationResult> {
    const delayMs = Number(
      this.configService.get<string | number>('MOCK_TRANSLATION_DELAY_MS') ??
        300,
    );

    if (input.sourceText.includes('__TIMEOUT__')) {
      const timeoutLimit = Number(
        this.configService.get<string | number>('TRANSLATION_TIMEOUT_MS') ??
          5000,
      );
      await new Promise((resolve) => setTimeout(resolve, timeoutLimit + 1000));
    } else {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    if (input.sourceText.includes('__ERROR__')) {
      throw new Error('Mock translation error');
    }

    return {
      providerLatencyMs: delayMs,
      requestId: input.requestId,
      sessionId: input.sessionId,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      translatedText: `[MOCK-${input.targetLanguage}] ${input.sourceText}`,
      turnId: input.turnId,
    };
  }
}
