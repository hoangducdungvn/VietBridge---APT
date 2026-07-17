import type { IAudioStreamRepository } from '@domain/repositories/IAudioStreamRepository';
import type { ITranslationSocketRepository } from '@domain/repositories/ITranslationSocketRepository';
import type { TranslationDirection } from '@shared/types';

// Application service that bridges captured audio chunks to the translation socket.
export class TranscriptStreamService {
  private unsubscribeFromChunks?: () => void;

  constructor(
    private readonly audioRepository: IAudioStreamRepository,
    private readonly socketRepository: ITranslationSocketRepository
  ) {}

  start(direction: TranslationDirection) {
    this.socketRepository.connect();
    this.unsubscribeFromChunks = this.audioRepository.onChunk((chunk) => {
      this.socketRepository.sendAudioChunk(chunk, direction);
    });
  }

  stop() {
    this.unsubscribeFromChunks?.();
    this.socketRepository.disconnect();
  }
}
