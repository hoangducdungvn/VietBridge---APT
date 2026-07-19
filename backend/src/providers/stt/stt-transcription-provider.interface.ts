import type { LanguageCode } from '../../common/types/language-code.type';
import type { SttEouMetadata } from '../../common/types/stt-eou.type';

export const STT_TRANSCRIPTION_PROVIDER = Symbol('STT_TRANSCRIPTION_PROVIDER');

export interface SttTranscriptionInput {
  audio: Buffer;
  isFinal: boolean;
  language: LanguageCode;
  turnId: string;
}

export interface SttTranscriptionResult {
  backend: string;
  eou?: SttEouMetadata;
  language: LanguageCode;
  lowConfidence: boolean;
  providerLatencyMs: number;
  text: string;
}

export interface SttTranscriptionProvider {
  transcribe(input: SttTranscriptionInput): Promise<SttTranscriptionResult>;
}
