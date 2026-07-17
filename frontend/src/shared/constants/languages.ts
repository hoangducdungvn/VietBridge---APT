import type { LanguageCode, TranslationDirection } from '@shared/types';

// Central language registry so new pairs can be added without touching UI components.
export const SUPPORTED_LANGUAGES: Array<{
  code: LanguageCode;
  label: string;
  nativeLabel: string;
}> = [
  { code: 'vi', label: 'Vietnamese', nativeLabel: 'Tiếng Việt' },
  { code: 'en', label: 'English', nativeLabel: 'English' }
];

export const DEFAULT_TRANSLATION_DIRECTION: TranslationDirection = 'vi-en';
