import type { LanguageCode } from '../common/types/language-code.type';

export type TurnStatus =
  | 'started'
  | 'streaming'
  | 'speech_ended'
  | 'stt_final'
  | 'translating'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ConversationTurn {
  turnId: string;
  sessionId: string;
  participantId: string;
  sequence: number;
  status: TurnStatus;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  partialText?: string;
  sourceText?: string;
  translatedText?: string;
  confidence?: number;
  errorCode?: string;
  startedAt: number;
  firstAudioAt?: number;
  lastAudioAt?: number;
  speechEndedAt?: number;
  firstPartialAt?: number;
  sttFinalAt?: number;
  translationStartedAt?: number;
  translationCompletedAt?: number;
  completedAt?: number;
}
