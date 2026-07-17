import { LanguageCode } from '../../common/types/language-code.type';

export interface AudioConfig {
  channels: number;
  codec: string;
  sampleRate: number;
}

export interface SttStartTurnInput {
  audioConfig: AudioConfig;
  language: LanguageCode;
  participantId: string;
  sessionId: string;
  turnId: string;
}

export interface SttSendAudioInput {
  audio: Buffer;
  sequence: number;
  sessionId: string;
  turnId: string;
}

export interface SttTurnReference {
  sessionId: string;
  turnId: string;
}

export interface SttPartialResult extends SttTurnReference {
  confidence?: number;
  providerLatencyMs?: number;
  text: string;
}

export interface SttFinalResult extends SttTurnReference {
  confidence?: number;
  language: LanguageCode;
  providerLatencyMs?: number;
  text: string;
}

export interface SttProviderError extends SttTurnReference {
  code: string;
  message: string;
  recoverable: boolean;
}

export interface SttDisconnectEvent {
  sessionId: string;
}

export interface SttEventHandlers {
  onDisconnect(event: SttDisconnectEvent): void;
  onError(error: SttProviderError): void;
  onFinal(result: SttFinalResult): void;
  onPartial(result: SttPartialResult): void;
}
