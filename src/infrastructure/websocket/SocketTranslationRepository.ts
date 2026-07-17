import { io, type Socket } from 'socket.io-client';
import type { TranscriptSegment } from '@domain/entities/TranscriptSegment';
import type { ITranslationSocketRepository } from '@domain/repositories/ITranslationSocketRepository';
import { mapTranslationEventToSegment, type TranslationEventDto } from '@application/mappers/translationMapper';
import { env } from '@infrastructure/config/env';
import { SOCKET_EVENTS } from '@shared/constants/socketEvents';
import type { TranslationDirection } from '@shared/types';

// Socket.IO adapter for streaming audio chunks and receiving ASR/MT events from the backend.
export class SocketTranslationRepository implements ITranslationSocketRepository {
  private socket?: Socket;

  connect() {
    if (this.socket?.connected) {
      return;
    }

    this.socket = io(env.backendWsUrl, {
      transports: ['websocket'],
      autoConnect: true
    });
  }

  disconnect() {
    this.socket?.disconnect();
    this.socket = undefined;
  }

  sendAudioChunk(chunk: Blob, direction: TranslationDirection) {
    this.socket?.emit(SOCKET_EVENTS.audioChunk, { chunk, direction, sentAt: Date.now() });
  }

  onTranscriptPartial(callback: (segment: TranscriptSegment) => void) {
    return this.listen(SOCKET_EVENTS.transcriptPartial, callback);
  }

  onTranscriptFinal(callback: (segment: TranscriptSegment) => void) {
    return this.listen(SOCKET_EVENTS.transcriptFinal, callback);
  }

  onTranslationResult(callback: (segment: TranscriptSegment) => void) {
    return this.listen(SOCKET_EVENTS.translationResult, callback);
  }

  private listen(eventName: string, callback: (segment: TranscriptSegment) => void) {
    this.connect();
    const handler = (payload: TranslationEventDto) => callback(mapTranslationEventToSegment(payload));
    this.socket?.on(eventName, handler);
    return () => this.socket?.off(eventName, handler);
  }
}
