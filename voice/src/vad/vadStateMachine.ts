export type VadState = 'IDLE' | 'POSSIBLE_SPEECH' | 'SPEAKING' | 'POSSIBLE_END';

export interface VadEvent {
  type: 'speech_start' | 'speech_end' | 'speech_continue';
  speechProbability: number;
  timestampMs: number;
  /** How many ms of pre-roll audio are available (speech_start only). */
  preRollMs?: number;
  /** Why the utterance ended (speech_end only). */
  reason?: 'vad_silence' | 'max_duration';
  /** How long the trailing silence was in ms (speech_end only). */
  silenceDurationMs?: number;
  /** Total speech duration in ms (speech_end only). */
  speechDurationMs?: number;
}

export interface VadDecisionConfig {
  frameDurationMs: number;
  minSpeechMs: number;
  preRollMs: number;
  endSilenceMs: number;
  maxUtteranceMs: number;
  energyStartThreshold: number;
  energyEndThreshold: number;
  sileroStartThreshold: number;
  sileroEndThreshold: number;
}

export interface VadProbabilities {
  energyAverage: number;
  energyInstant: number;
  sileroAverage: number | null;
  sileroInstant: number | null;
}

interface VadDecision {
  silenceDetected: boolean;
  speechDetected: boolean;
  speechProbability: number;
}

/** Pure VAD lifecycle state machine, independent of ONNX and audio capture. */
export class VadStateMachine {
  private state: VadState = 'IDLE';
  private speechStartTime = 0;
  private silenceStartTime = 0;
  private possibleSpeechAccMs = 0;

  constructor(private readonly config: VadDecisionConfig) {}

  getState(): VadState {
    return this.state;
  }

  reset(): void {
    this.state = 'IDLE';
    this.speechStartTime = 0;
    this.silenceStartTime = 0;
    this.possibleSpeechAccMs = 0;
  }

  process(
    probabilities: VadProbabilities,
    timestampMs: number,
    preRollAvailableMs: number,
  ): VadEvent | null {
    const decision = this.decide(probabilities);

    switch (this.state) {
      case 'IDLE':
        if (decision.speechDetected) {
          this.state = 'POSSIBLE_SPEECH';
          this.possibleSpeechAccMs = this.config.frameDurationMs;
          this.speechStartTime = timestampMs;
        }
        return null;

      case 'POSSIBLE_SPEECH':
        if (!decision.speechDetected) {
          this.state = 'IDLE';
          this.possibleSpeechAccMs = 0;
          return null;
        }

        this.possibleSpeechAccMs += this.config.frameDurationMs;
        if (this.possibleSpeechAccMs < this.config.minSpeechMs) return null;

        this.state = 'SPEAKING';
        return {
          type: 'speech_start',
          speechProbability: decision.speechProbability,
          timestampMs,
          preRollMs: Math.min(preRollAvailableMs, this.config.preRollMs),
        };

      case 'SPEAKING': {
        const elapsed = timestampMs - this.speechStartTime;
        if (elapsed >= this.config.maxUtteranceMs) {
          return this.endUtterance(
            decision.speechProbability,
            timestampMs,
            'max_duration',
            elapsed,
            0,
          );
        }

        if (decision.silenceDetected) {
          this.state = 'POSSIBLE_END';
          this.silenceStartTime = timestampMs;
        }
        return null;
      }

      case 'POSSIBLE_END': {
        const silenceDuration = timestampMs - this.silenceStartTime;
        const speechDuration = timestampMs - this.speechStartTime;
        if (speechDuration >= this.config.maxUtteranceMs) {
          return this.endUtterance(
            decision.speechProbability,
            timestampMs,
            'max_duration',
            speechDuration,
            silenceDuration,
          );
        }

        if (decision.speechDetected) {
          this.state = 'SPEAKING';
          return {
            type: 'speech_continue',
            speechProbability: decision.speechProbability,
            timestampMs,
          };
        }

        if (silenceDuration >= this.config.endSilenceMs) {
          return this.endUtterance(
            decision.speechProbability,
            timestampMs,
            'vad_silence',
            speechDuration,
            silenceDuration,
          );
        }
        return null;
      }
    }
  }

  private decide(probabilities: VadProbabilities): VadDecision {
    const energySpeech =
      probabilities.energyAverage > this.config.energyStartThreshold;
    const hasSilero = probabilities.sileroAverage !== null;
    const sileroSpeech =
      hasSilero &&
      probabilities.sileroAverage! > this.config.sileroStartThreshold;

    // Either detector may rescue speech. Silence requires Silero agreement and
    // no strong Energy evidence, so an Energy baseline around 0.5 cannot mask
    // Silero EOU while real high-energy speech is never cut off by Silero alone.
    const speechDetected = energySpeech || sileroSpeech;
    const silenceDetected = hasSilero
      ? probabilities.sileroAverage! < this.config.sileroEndThreshold &&
        !energySpeech
      : probabilities.energyAverage < this.config.energyEndThreshold;

    const speechProbability = sileroSpeech
      ? (probabilities.sileroInstant ?? probabilities.energyInstant)
      : probabilities.energyInstant;

    return { silenceDetected, speechDetected, speechProbability };
  }

  private endUtterance(
    speechProbability: number,
    timestampMs: number,
    reason: 'vad_silence' | 'max_duration',
    speechDurationMs: number,
    silenceDurationMs: number,
  ): VadEvent {
    this.state = 'IDLE';
    this.possibleSpeechAccMs = 0;
    return {
      type: 'speech_end',
      speechProbability,
      timestampMs,
      reason,
      speechDurationMs,
      silenceDurationMs,
    };
  }
}
