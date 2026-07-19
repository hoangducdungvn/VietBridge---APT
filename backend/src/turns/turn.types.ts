import type { LanguageCode } from '../common/types/language-code.type';
import type { SttEouMetadata } from '../common/types/stt-eou.type';

export interface TurnAudioConfig {
  channels: 1;
  codec: 'pcm_s16le';
  sampleRate: 16000;
}

export type TurnStatus =
  'started' | 'streaming' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface StoredTurn {
  audioBytes: number;
  audioChunks: Buffer[];
  audioConfig: TurnAudioConfig;
  completedAt?: number;
  eou?: SttEouMetadata;
  errorCode?: string;
  finalText?: string;
  firstAudioAt?: number;
  lastAudioAt?: number;
  lastAudioSequence: number;
  lowConfidence?: boolean;
  providerLatencyMs?: number;
  sttBackend?: string;
  participantId: string;
  sequence: number;
  sessionId: string;
  sourceLanguage: LanguageCode;
  startedAt: number;
  status: TurnStatus;
  targetLanguage: LanguageCode;
  turnId: string;
}

export interface StartTurnResult {
  sequence: number;
  turnId: string;
}

export interface AudioChunkInput {
  audio: unknown;
  participantId: string;
  sequence: number;
  sessionId: string;
  turnId: string;
}

export interface EndTurnResult {
  backend?: string;
  duplicate: boolean;
  eou?: SttEouMetadata;
  language: LanguageCode;
  lowConfidence?: boolean;
  participantId: string;
  providerLatencyMs?: number;
  sequence: number;
  startedAt: number;
  targetLanguage: LanguageCode;
  text: string;
  turnId: string;
}

export interface TurnTranscriptionSnapshot {
  audio: Buffer;
  language: LanguageCode;
  participantId: string;
  sessionId: string;
  turnId: string;
}
