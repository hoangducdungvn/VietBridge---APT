import type { TranscriptSegment } from '@domain/entities/TranscriptSegment';
import type { LanguageCode, TranslationDirection } from '@shared/types';

export interface TranslationEventDto {
  id: string;
  speakerId?: string;
  sourceText: string;
  translatedText?: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  direction: TranslationDirection;
  isFinal?: boolean;
  confidence?: number;
  startedAt?: number;
  endedAt?: number;
}

// Mapper translating backend stream DTOs into domain transcript segments.
export function mapTranslationEventToSegment(dto: TranslationEventDto): TranscriptSegment {
  return {
    id: dto.id,
    speakerId: dto.speakerId ?? 'speaker-unknown',
    sourceText: dto.sourceText,
    translatedText: dto.translatedText,
    sourceLanguage: dto.sourceLanguage,
    targetLanguage: dto.targetLanguage,
    direction: dto.direction,
    isFinal: dto.isFinal ?? false,
    startedAt: dto.startedAt ?? Date.now(),
    endedAt: dto.endedAt,
    confidence: dto.confidence
  };
}
