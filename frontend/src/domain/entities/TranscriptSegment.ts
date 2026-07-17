import type { LanguageCode, TranslationDirection } from '@shared/types';

// Domain entity for one partial or final utterance displayed in the meeting transcript.
export interface TranscriptSegment {
  id: string;
  speakerId: string;
  sourceText: string;
  translatedText?: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  direction: TranslationDirection;
  isFinal: boolean;
  startedAt: number;
  endedAt?: number;
  confidence?: number;
}
