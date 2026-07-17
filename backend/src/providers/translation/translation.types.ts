import { LanguageCode } from '../../common/types/language-code.type';

export interface ContextTurn {
  sourceLanguage: LanguageCode;
  sourceText: string;
  translatedText: string;
}

export interface TranslationInput {
  context: readonly ContextTurn[];
  glossary: Readonly<Record<string, string>>;
  requestId: string;
  sessionId: string;
  sourceLanguage: LanguageCode;
  sourceText: string;
  targetLanguage: LanguageCode;
  turnId: string;
}

export interface TranslationResult {
  providerLatencyMs?: number;
  requestId: string;
  sessionId: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  translatedText: string;
  turnId: string;
}
