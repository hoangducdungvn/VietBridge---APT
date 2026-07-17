import type { IAudioStreamRepository } from '@domain/repositories/IAudioStreamRepository';

// Use-case for ending microphone capture and releasing browser audio resources.
export class StopListening {
  constructor(private readonly audioRepository: IAudioStreamRepository) {}

  execute() {
    return this.audioRepository.stop();
  }
}
