import type { TranscriptSegment } from '@domain/entities/TranscriptSegment';
import type { TranslationDirection } from '@shared/types';

// Port for streaming audio to the backend and receiving transcript/translation events.
export interface ITranslationSocketRepository {
  connect(): void;
  disconnect(): void;
  sendAudioChunk(chunk: Blob, direction: TranslationDirection): void;
  onTranscriptPartial(callback: (segment: TranscriptSegment) => void): () => void;
  onTranscriptFinal(callback: (segment: TranscriptSegment) => void): () => void;
  onTranslationResult(callback: (segment: TranscriptSegment) => void): () => void;
}
