// Utterance lifecycle manager — tracks active utterances, continuation
// chains, and per-utterance quality aggregation.

import { v4 as uuidv4 } from 'uuid';
import type { VadEvent } from '../vad/vadEngine';
import type { AudioQuality } from '../audio/resampler';
import type {
  UtteranceEndReason,
  QualitySummary,
  NoiseLevel,
  LanguageHint,
  SpeakerState,
  VadInfo,
} from '../protocol/types';

export type { AudioQuality };

// ---------------------------------------------------------------------------
// UtteranceInfo
// ---------------------------------------------------------------------------

export interface UtteranceInfo {
  utteranceId: string;
  startTimeMs: number;
  endTimeMs?: number;
  /** Chunk count within this utterance (1-indexed, incremented per chunk). */
  utteranceSequence: number;
  /** Stream sequence number at utterance start. */
  firstStreamSequence: number;
  /** Stream sequence number at utterance end. */
  lastStreamSequence: number;
  /** Shared ID linking utterances split by max_duration. */
  continuationId?: string;
  /** The utterance that preceded this one in a continuation chain. */
  continuedFromUtteranceId?: string | null;
  /** Collected per-chunk quality samples for summary computation. */
  qualitySamples: AudioQuality[];
}

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

export interface UtteranceCallbacks {
  onUtteranceStart(info: {
    utterance_id: string;
    participant_id: string;
    speaker_id: string | null;
    speaker_state: SpeakerState;
    language_hint: LanguageHint;
    start_time_ms: number;
    vad: VadInfo;
    continuation_id?: string;
    continued_from_utterance_id?: string | null;
  }): void;

  onUtteranceEnd(info: {
    utterance_id: string;
    speaker_id: string | null;
    end_time_ms: number;
    last_sequence: number;
    reason: UtteranceEndReason;
    trailing_silence_ms: number;
    audio_duration_ms: number;
    quality_summary: QualitySummary;
    continuation_id?: string;
    has_next?: boolean;
  }): void;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface UtteranceManagerConfig {
  participantId: string;
  speakerId: string | null;
  speakerState: SpeakerState;
  languageHint: LanguageHint;
}

// ---------------------------------------------------------------------------
// UtteranceManager
// ---------------------------------------------------------------------------

export class UtteranceManager {
  private current: UtteranceInfo | null = null;
  private activeContinuationId: string | null = null;

  constructor(
    private config: UtteranceManagerConfig,
    private callbacks: UtteranceCallbacks,
  ) {}

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Called when the VAD emits a `speech_start` event.
   *
   * Creates a new {@link UtteranceInfo}, fires `onUtteranceStart`, and begins
   * collecting quality samples.
   */
  handleSpeechStart(event: VadEvent, currentSequence: number): void {
    const utteranceId = uuidv4();

    // If there is an active continuation chain (max_duration split in
    // progress), carry it forward.
    const continuationId = this.activeContinuationId ?? undefined;
    const continuedFromUtteranceId = this.current?.utteranceId ?? null;

    this.current = {
      utteranceId,
      startTimeMs: event.timestampMs,
      utteranceSequence: 0,
      firstStreamSequence: currentSequence,
      lastStreamSequence: currentSequence,
      continuationId,
      continuedFromUtteranceId: this.activeContinuationId
        ? continuedFromUtteranceId
        : null,
      qualitySamples: [],
    };

    const vadInfo: VadInfo = {
      engine: 'energy-vad',
      speech_probability: event.speechProbability,
      pre_roll_ms: event.preRollMs ?? 0,
    };

    this.callbacks.onUtteranceStart({
      utterance_id: utteranceId,
      participant_id: this.config.participantId,
      speaker_id: this.config.speakerId,
      speaker_state: this.config.speakerState,
      language_hint: this.config.languageHint,
      start_time_ms: event.timestampMs,
      vad: vadInfo,
      continuation_id: continuationId,
      continued_from_utterance_id: this.activeContinuationId
        ? continuedFromUtteranceId
        : undefined,
    });
  }

  /**
   * Called when the VAD emits a `speech_end` event.
   *
   * If the reason is `max_duration` the current utterance is closed with
   * `has_next = true` and a new one is immediately opened under the same
   * `continuation_id`.  For `vad_silence` the utterance is closed normally
   * and the continuation chain is cleared.
   */
  handleSpeechEnd(event: VadEvent, currentSequence: number): void {
    if (!this.current) return;

    const reason: UtteranceEndReason = event.reason ?? 'vad_silence';

    if (reason === 'max_duration') {
      // Start a continuation chain if we haven't already.
      if (!this.activeContinuationId) {
        this.activeContinuationId = uuidv4();
        this.current.continuationId = this.activeContinuationId;
      }

      this.closeUtterance(reason, event.timestampMs, currentSequence, {
        hasNext: true,
        trailingSilenceMs: event.silenceDurationMs ?? 0,
      });

      // Immediately open a new utterance as continuation.
      this.handleSpeechStart(event, currentSequence);
    } else {
      // Normal silence-based end — close and clear continuation.
      this.closeUtterance(reason, event.timestampMs, currentSequence, {
        hasNext: false,
        trailingSilenceMs: event.silenceDurationMs ?? 0,
      });
      this.activeContinuationId = null;
    }
  }

  /**
   * Called for each audio chunk sent while an utterance is active.
   *
   * Increments `utterance_sequence`, stores the quality sample, and returns
   * the new sequence number.  Returns `null` if no utterance is active.
   */
  trackChunk(quality: AudioQuality): number | null {
    if (!this.current) return null;

    this.current.utteranceSequence++;
    this.current.qualitySamples.push(quality);
    return this.current.utteranceSequence;
  }

  /** Return the current utterance ID, or `null` if none is active. */
  getCurrentUtteranceId(): string | null {
    return this.current?.utteranceId ?? null;
  }

  /** Whether an utterance is currently active. */
  isActive(): boolean {
    return this.current !== null;
  }

  /**
   * Force-close the current utterance for abnormal reasons such as
   * `user_stop`, `source_lost`, `connection_close`, or `session_end`.
   */
  forceClose(
    reason: UtteranceEndReason,
    timestampMs: number,
    currentSequence: number,
  ): void {
    if (!this.current) return;

    this.closeUtterance(reason, timestampMs, currentSequence, {
      hasNext: false,
      trailingSilenceMs: 0,
    });
    this.activeContinuationId = null;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private closeUtterance(
    reason: UtteranceEndReason,
    timestampMs: number,
    currentSequence: number,
    opts: { hasNext: boolean; trailingSilenceMs: number },
  ): void {
    if (!this.current) return;

    this.current.endTimeMs = timestampMs;
    this.current.lastStreamSequence = currentSequence;

    const audioDurationMs = timestampMs - this.current.startTimeMs;
    const qualitySummary = this.computeQualitySummary();

    this.callbacks.onUtteranceEnd({
      utterance_id: this.current.utteranceId,
      speaker_id: this.config.speakerId,
      end_time_ms: timestampMs,
      last_sequence: currentSequence,
      reason,
      trailing_silence_ms: opts.trailingSilenceMs,
      audio_duration_ms: audioDurationMs,
      quality_summary: qualitySummary,
      continuation_id: this.current.continuationId,
      has_next: opts.hasNext || undefined,
    });

    // If not continuing, clear the current utterance.
    if (!opts.hasNext) {
      this.current = null;
    }
  }

  /**
   * Aggregate the collected per-chunk {@link AudioQuality} samples into a
   * single {@link QualitySummary}.
   */
  private computeQualitySummary(): QualitySummary {
    const samples = this.current?.qualitySamples ?? [];

    if (samples.length === 0) {
      return {
        average_snr_db: 0,
        clipping_ratio: 0,
        dropped_chunks: 0,
        noise_level: 'severe',
      };
    }

    let totalSnr = 0;
    let maxClipping = 0;
    let droppedCount = 0;

    for (const s of samples) {
      totalSnr += s.estimated_snr_db;
      if (s.clipping_ratio > maxClipping) {
        maxClipping = s.clipping_ratio;
      }
    }

    const avgSnr = totalSnr / samples.length;

    return {
      average_snr_db: Math.round(avgSnr * 100) / 100,
      clipping_ratio: Math.round(maxClipping * 10000) / 10000,
      dropped_chunks: droppedCount,
      noise_level: this.classifyNoise(avgSnr),
    };
  }

  /**
   * Classify ambient noise severity from average SNR (dB).
   *
   * | SNR range | Level      |
   * |-----------|------------|
   * | ≥ 25 dB   | low        |
   * | ≥ 15 dB   | moderate   |
   * | ≥ 8 dB    | high       |
   * | < 8 dB    | severe     |
   */
  private classifyNoise(avgSnr: number): NoiseLevel {
    if (avgSnr >= 25) return 'low';
    if (avgSnr >= 15) return 'moderate';
    if (avgSnr >= 8) return 'high';
    return 'severe';
  }
}
