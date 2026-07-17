import type { LanguageCode } from '@shared/types';

// Domain value object for a supported source and target language direction.
export interface TranslationPair {
  source: LanguageCode;
  target: LanguageCode;
}
