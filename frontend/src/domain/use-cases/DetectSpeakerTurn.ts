// Use-case placeholder for deciding when a speech turn starts, ends, or changes speaker.
export class DetectSpeakerTurn {
  execute(audioEnergy: number, silenceMs: number) {
    return audioEnergy > 0.01 && silenceMs < 800;
  }
}
