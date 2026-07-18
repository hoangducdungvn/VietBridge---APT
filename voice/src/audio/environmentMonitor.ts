// EnvironmentMonitor — decides when the current capture mode no longer matches
// the acoustic environment and suggests switching Studio Mode on/off.
//
// Purely additive: consumes signals the pipeline already emits (per-frame
// quality via onAudioLevel, VAD state, STT results) — no new measurements,
// no coupling into the audio path. Thresholds follow contract §12.3 metrics.

export type EnvLevel = 'quiet' | 'moderate' | 'noisy';

export interface EnvSuggestion {
  action: 'enable_studio' | 'disable_studio';
  reason: string;
}

export interface EnvironmentMonitorEvents {
  /** Fired whenever the classified environment level changes. */
  onLevelChange?(level: EnvLevel, noiseFloorDbfs: number): void;
  /** Fired at most once per cooldown window; never again after dismiss(). */
  onSuggestion?(suggestion: EnvSuggestion): void;
}

const NOISE_FLOOR_QUIET_DBFS = -55;  // below: quiet room
const NOISE_FLOOR_NOISY_DBFS = -45;  // above: noisy hall (−55…−45 = hysteresis band)
const SUSTAIN_MS = 5_000;            // level must hold this long before suggesting
const COOLDOWN_MS = 120_000;         // ≤1 suggestion per 2 minutes
const IDLE_RING_SIZE = 250;          // ~5s of 20ms frames measured during VAD IDLE
const STT_WINDOW_MS = 120_000;       // ghost-utterance ratio window
const STT_BAD_RATIO = 0.4;           // >40% empty/low-confidence finals = phantom utterances
const STT_MIN_SAMPLES = 5;

export class EnvironmentMonitor {
  private studioMode: boolean;
  private events: EnvironmentMonitorEvents;

  private idleRms: number[] = [];
  private idleWriteIdx = 0;
  private level: EnvLevel = 'moderate';
  private levelSince = 0;
  private lastSuggestionAt = 0;
  private dismissed = false;
  private sttResults: { at: number; bad: boolean }[] = [];

  constructor(studioMode: boolean, events: EnvironmentMonitorEvents = {}) {
    this.studioMode = studioMode;
    this.events = events;
  }

  /** Call from onAudioLevel with the pipeline's current VAD state. */
  feedLevel(rmsDbfs: number, vadState: string, now: number = Date.now()): void {
    // Only IDLE frames measure the room, not the speaker.
    if (vadState !== 'IDLE') return;

    if (this.idleRms.length < IDLE_RING_SIZE) {
      this.idleRms.push(rmsDbfs);
    } else {
      this.idleRms[this.idleWriteIdx] = rmsDbfs;
      this.idleWriteIdx = (this.idleWriteIdx + 1) % IDLE_RING_SIZE;
    }
    if (this.idleRms.length < IDLE_RING_SIZE / 5) return; // ≥1s of data first

    const floor = median(this.idleRms);
    const newLevel: EnvLevel =
      floor < NOISE_FLOOR_QUIET_DBFS ? 'quiet'
      : floor > NOISE_FLOOR_NOISY_DBFS ? 'noisy'
      : 'moderate';

    if (newLevel !== this.level) {
      this.level = newLevel;
      this.levelSince = now;
      this.events.onLevelChange?.(newLevel, floor);
    }

    if (now - this.levelSince < SUSTAIN_MS) return;
    if (this.level === 'noisy' && this.studioMode) {
      this.suggest(
        { action: 'disable_studio', reason: `Môi trường ồn (nền ${floor.toFixed(0)} dBFS) — nên tắt Studio Mode` },
        now,
      );
    } else if (this.level === 'quiet' && !this.studioMode) {
      this.suggest(
        { action: 'enable_studio', reason: `Môi trường yên tĩnh (nền ${floor.toFixed(0)} dBFS) — bật Studio Mode để giọng tự nhiên hơn` },
        now,
      );
    }
  }

  /** Call for every stt.final result: phantom-utterance ratio check. */
  feedSttFinal(textEmpty: boolean, lowConfidence: boolean, now: number = Date.now()): void {
    this.sttResults.push({ at: now, bad: textEmpty || lowConfidence });
    this.sttResults = this.sttResults.filter((r) => now - r.at <= STT_WINDOW_MS);
    if (this.sttResults.length < STT_MIN_SAMPLES) return;

    const badRatio = this.sttResults.filter((r) => r.bad).length / this.sttResults.length;
    if (badRatio > STT_BAD_RATIO && this.studioMode) {
      this.suggest(
        { action: 'disable_studio', reason: `${Math.round(badRatio * 100)}% utterance gần đây rỗng/kém tin cậy — VAD có thể đang ăn tiếng xung quanh, nên tắt Studio Mode` },
        now,
      );
    }
  }

  getLevel(): EnvLevel {
    return this.level;
  }

  /** User clicked "bỏ qua" — stay silent for the rest of the session. */
  dismiss(): void {
    this.dismissed = true;
  }

  private suggest(s: EnvSuggestion, now: number): void {
    if (this.dismissed || now - this.lastSuggestionAt < COOLDOWN_MS) return;
    this.lastSuggestionAt = now;
    this.events.onSuggestion?.(s);
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
