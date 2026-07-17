import type { IAudioStreamRepository } from '@domain/repositories/IAudioStreamRepository';
import { StartListening } from '@domain/use-cases/StartListening';
import { StopListening } from '@domain/use-cases/StopListening';

// Application service coordinating start/stop meeting behavior across use-cases.
export class MeetingSessionService {
  private readonly startListening: StartListening;
  private readonly stopListening: StopListening;

  constructor(audioRepository: IAudioStreamRepository) {
    this.startListening = new StartListening(audioRepository);
    this.stopListening = new StopListening(audioRepository);
  }

  start() {
    return this.startListening.execute();
  }

  stop() {
    return this.stopListening.execute();
  }
}
