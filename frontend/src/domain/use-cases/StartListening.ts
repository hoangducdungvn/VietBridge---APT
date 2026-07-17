import type { IAudioStreamRepository } from '@domain/repositories/IAudioStreamRepository';

// Use-case for beginning microphone capture through the audio repository port.
export class StartListening {
  constructor(private readonly audioRepository: IAudioStreamRepository) {}

  execute() {
    return this.audioRepository.start();
  }
}
