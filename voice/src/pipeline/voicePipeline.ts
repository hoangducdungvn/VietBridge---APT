// VoicePipeline — orchestrates the entire capture → DSP → VAD → utterance →
// packetize → WebSocket chain per docs/audio-streaming-contract.md §2.
//
// Data flow:
//   AudioWorklet frame → Resampler(16kHz) → VAD → UtteranceManager → WsClient
//
// This module is the single public entry point that the UI (main.ts) interacts
// with.  All internal wiring between audio, vad, utterance and protocol layers
// happens here.

import { v4 as uuidv4 } from "uuid";
import {
  WebAudioCaptureAdapter,
  type AudioFrame,
  type DeviceState,
} from "../audio/captureAdapter";
import { type AudioQuality } from "../audio/resampler";
import { VadEngine, type VadState, type VadEvent } from "../vad/vadEngine";
import {
  UtteranceManager,
  type UtteranceCallbacks,
} from "../utterance/utteranceManager";
import {
  VoiceStreamClient,
  type VoiceStreamClientConfig,
  type VoiceStreamClientEvents,
  type ConnectionState,
  type SttResultEvent,
  type TranslationResultEvent,
} from "../protocol/wsClient";
import type {
  VoiceTransport,
  VoiceTransportFactory,
} from "../protocol/voiceTransport";
import type { SpeakerState, LanguageHint } from "../protocol/types";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface VoicePipelineConfig {
  /** WebSocket URL of the ingestion gateway. */
  gatewayUrl: string;
  /** ID for this meeting session. */
  sessionId?: string;
  /** Identifier for this audio source (e.g. "mic-a"). */
  sourceId?: string;
  /** Participant ID at the business layer. */
  participantId?: string;
  /** Speaker ID — static mapping from mic, per §3.1. */
  speakerId?: string | null;
  /** Language hint: "vi", "en" or "auto". */
  languageHint?: LanguageHint;
  /** Specific microphone deviceId to capture from. */
  deviceId?: string;
  /** How many 20ms frames to group before sending (2–3 = 40–60ms, per §5.2). */
  chunkGroupSize?: number;
  /** Disable ONNX loading when the host app only ships energy VAD assets. */
  enableSileroVad?: boolean;
  /** Override raw WebSocket transport with the host application's transport. */
  transportFactory?: VoiceTransportFactory;
}

// ---------------------------------------------------------------------------
// Events emitted by the pipeline to the UI
// ---------------------------------------------------------------------------

export interface VoicePipelineEvents {
  onConnectionStateChange?(state: ConnectionState): void;
  onVadStateChange?(state: VadState): void;
  onDeviceStateChange?(state: DeviceState): void;
  onAudioLevel?(quality: AudioQuality): void;
  onUtteranceStart?(utteranceId: string): void;
  onUtteranceEnd?(utteranceId: string, reason: string): void;
  onChunkSent?(sequence: number): void;
  onLog?(message: string): void;
  onError?(code: string, message: string): void;
  onAcked?(sequence: number): void;
  onSttResult?(result: SttResultEvent): void;
  onTranslationResult?(result: TranslationResultEvent): void;
}

// ---------------------------------------------------------------------------
// VoicePipeline
// ---------------------------------------------------------------------------

export class VoicePipeline {
  private capture: WebAudioCaptureAdapter;
  private vad: VadEngine;
  private utteranceManager!: UtteranceManager;
  private transport!: VoiceTransport;

  private config: Required<Omit<VoicePipelineConfig, "transportFactory">> &
    Pick<VoicePipelineConfig, "transportFactory">;
  private events: VoicePipelineEvents;

  private sessionStartTime = 0;
  private running = false;

  // Chunk grouping buffer: accumulate N 20ms frames then send as one chunk
  private chunkBuffer: Int16Array[] = [];
  private chunkQualityBuffer: AudioQuality[] = [];
  private chunkCaptureStartMs = 0;
  private totalChunksSent = 0;
  private totalUtterances = 0;
  private totalAudioDurationMs = 0;

  constructor(config: VoicePipelineConfig, events: VoicePipelineEvents = {}) {
    this.config = {
      gatewayUrl: config.gatewayUrl,
      sessionId: config.sessionId ?? `ses-${uuidv4()}`,
      sourceId: config.sourceId ?? `mic-${uuidv4().slice(0, 8)}`,
      participantId: config.participantId ?? `part-${uuidv4().slice(0, 8)}`,
      speakerId: config.speakerId ?? "speaker-a",
      languageHint: config.languageHint ?? "vi",
      deviceId: config.deviceId ?? "",
      enableSileroVad: config.enableSileroVad ?? true,
      chunkGroupSize: config.chunkGroupSize ?? 2, // 2 × 20ms = 40ms per chunk
      transportFactory: config.transportFactory,
    };

    this.events = events;
    this.capture = new WebAudioCaptureAdapter();
    this.vad = new VadEngine();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Start the full pipeline: capture → VAD → WS. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.sessionStartTime = performance.now();
    this.totalChunksSent = 0;
    this.totalUtterances = 0;
    this.totalAudioDurationMs = 0;

    this.log("Starting voice pipeline...");

    // 0. R2: Try to load Silero AI VAD (non-blocking — fallback to energy VAD on error)
    if (this.config.enableSileroVad) {
      this.log("Loading AI VAD model (Silero)...");
      const sileroLoaded = await this.vad.loadSilero("/models/silero_vad.onnx");
      if (sileroLoaded) {
        this.log("AI VAD (Silero) loaded");
      } else {
        this.log("Silero unavailable - using energy VAD fallback");
      }
    }
    this.events.onLog?.(`VAD backend: ${this.vad.getBackend()}`);

    // 1. Init utterance manager
    const uttCallbacks: UtteranceCallbacks = {
      onUtteranceStart: (info) => {
        this.transport.sendUtteranceStart(info);
        this.totalUtterances++;
        this.events.onUtteranceStart?.(info.utterance_id);
        this.log(
          `utterance.start: ${info.utterance_id} (speaker=${info.speaker_id})`,
        );
      },
      onUtteranceEnd: (info) => {
        this.transport.sendUtteranceEnd(info);
        this.events.onUtteranceEnd?.(info.utterance_id, info.reason);
        this.log(
          `utterance.end: ${info.utterance_id} reason=${info.reason} dur=${info.audio_duration_ms}ms`,
        );
      },
    };

    this.utteranceManager = new UtteranceManager(
      {
        participantId: this.config.participantId,
        speakerId: this.config.speakerId,
        speakerState: (this.config.speakerId
          ? "assigned"
          : "unknown") as SpeakerState,
        languageHint: this.config.languageHint,
      },
      uttCallbacks,
    );

    // 2. Init WS client
    const wsConfig: VoiceStreamClientConfig = {
      url: this.config.gatewayUrl,
      sessionId: this.config.sessionId,
      streamId: `stream-${this.config.sourceId}`,
      sourceId: this.config.sourceId,
      participantId: this.config.participantId,
      speakerId: this.config.speakerId,
      languageHint: this.config.languageHint,
      deviceId: `device-${this.config.sourceId}`,
    };

    const wsEvents: VoiceStreamClientEvents = {
      onStateChange: (state) => {
        this.events.onConnectionStateChange?.(state);
        this.log(`Connection: ${state}`);
      },
      onLog: (msg) => this.log(`[WS] ${msg}`),
      onServerAck: (ack) => {
        this.events.onAcked?.(ack.highest_contiguous_sequence);
      },
      onThrottle: (evt) => {
        this.log(`Server throttle: delay=${evt.estimated_queue_delay_ms}ms`);
      },
      onBackpressure: (evt) => {
        this.log(`Server backpressure: ${evt.message}`);
        this.events.onError?.("SERVER_BACKPRESSURE", evt.message);
      },
      onSttResult: (res) => {
        this.events.onSttResult?.(res);
      },
      onTranslationResult: (res) => {
        this.events.onTranslationResult?.(res);
      },
    };

    this.transport = this.config.transportFactory
      ? this.config.transportFactory(wsConfig, wsEvents)
      : new VoiceStreamClient(wsConfig, wsEvents);

    // 3. Connect WS
    try {
      await this.transport.connect();
      this.log("WebSocket connected");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log(`WebSocket connect failed: ${msg}`);
      this.events.onError?.("WEBSOCKET_DISCONNECTED", msg);
      this.transport.disconnect();
      this.running = false;
      throw new Error(`WebSocket connect failed: ${msg}`);
    }

    // 4. Setup capture handlers
    this.capture.onAudioFrame((frame) => this.handleAudioFrame(frame));
    this.capture.onDeviceState((state) => {
      this.events.onDeviceStateChange?.(state);
      if (state.type === "disconnected") {
        this.log("Microphone disconnected");
        if (this.utteranceManager.isActive()) {
          const timestampMs = performance.now() - this.sessionStartTime;
          this.utteranceManager.forceClose(
            "source_lost",
            timestampMs,
            this.transport.getCurrentSequence(),
          );
        }
        this.events.onError?.(
          "MICROPHONE_DISCONNECTED",
          "Audio input device became unavailable",
        );
      } else if (state.type === "permission_denied") {
        this.log("Microphone permission denied");
        this.events.onError?.(
          "MICROPHONE_PERMISSION_DENIED",
          "User denied microphone access",
        );
      } else if (state.type === "active") {
        this.log(`Microphone active: ${state.deviceLabel}`);
      } else if (state.type === "error") {
        this.log(`Microphone error: ${state.message}`);
        this.events.onError?.("MICROPHONE_DISCONNECTED", state.message);
      }
    });

    // 5. Start capture
    try {
      await this.capture.start({
        deviceId: this.config.deviceId || undefined,
      });
      this.log("Audio capture started");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log(`Capture start failed: ${msg}`);
      const code =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "MICROPHONE_PERMISSION_DENIED"
          : "MICROPHONE_DISCONNECTED";
      this.events.onError?.(code, msg);
      await this.capture.stop();
      this.transport.disconnect();
      this.running = false;
      throw new Error(`Capture start failed: ${msg}`);
    }
  }

  /** Stop the pipeline gracefully. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    this.log("Stopping voice pipeline...");

    // Close any active utterance
    if (this.utteranceManager?.isActive()) {
      const timestampMs = performance.now() - this.sessionStartTime;
      this.utteranceManager.forceClose(
        "session_end",
        timestampMs,
        this.transport.getCurrentSequence(),
      );
    }

    // Stop capture
    await this.capture.stop();

    // Disconnect WS
    this.transport?.disconnect();

    this.vad.reset();
    this.chunkBuffer = [];
    this.chunkQualityBuffer = [];

    this.log("Voice pipeline stopped");
  }

  /** Get session metrics for display. */
  getMetrics() {
    return {
      totalChunksSent: this.totalChunksSent,
      totalUtterances: this.totalUtterances,
      totalAudioDurationMs: this.totalAudioDurationMs,
      currentSequence: this.transport?.getCurrentSequence() ?? 0,
      connectionState: this.transport?.getState() ?? "idle",
      vadState: this.vad.getState(),
      isRunning: this.running,
    };
  }

  // -------------------------------------------------------------------------
  // Internal: audio frame processing
  // -------------------------------------------------------------------------

  private handleAudioFrame(frame: AudioFrame): void {
    if (!this.running) return;

    const timestampMs = frame.captureStartMs;

    // Emit audio level to UI
    this.events.onAudioLevel?.(frame.quality);

    // Convert Int16 PCM back to Float32 for VAD processing
    // (VAD works on float samples)
    const float32ForVad = new Float32Array(frame.pcm.length);
    for (let i = 0; i < frame.pcm.length; i++) {
      float32ForVad[i] = frame.pcm[i] / 32768;
    }

    // Run VAD on the 16kHz frame
    const vadEvent = this.vad.processFrame(float32ForVad, timestampMs);
    const vadState = this.vad.getState();

    // Emit VAD state
    this.events.onVadStateChange?.(vadState);

    // Handle VAD events
    if (vadEvent) {
      this.handleVadEvent(vadEvent);
    }

    // Buffer the frame for chunk grouping (§5.2: send 40-60ms)
    this.chunkBuffer.push(frame.pcm);
    this.chunkQualityBuffer.push(frame.quality);
    if (this.chunkBuffer.length === 1) {
      this.chunkCaptureStartMs = timestampMs;
    }

    // Flush when we have enough frames grouped
    if (this.chunkBuffer.length >= this.config.chunkGroupSize) {
      this.flushChunkBuffer(timestampMs);
    }
  }

  private handleVadEvent(event: VadEvent): void {
    const currentSeq = this.transport.getCurrentSequence();

    switch (event.type) {
      case "speech_start": {
        this.utteranceManager.handleSpeechStart(event, currentSeq);

        // Send pre-roll frames as audio chunks
        const preRollFrames = this.vad.getPreRollFrames();
        if (preRollFrames.length > 0) {
          this.log(`Sending ${preRollFrames.length} pre-roll frames`);
          for (const preRollFrame of preRollFrames) {
            // Convert to Int16 for sending
            const pcm = new Int16Array(preRollFrame.length);
            for (let i = 0; i < preRollFrame.length; i++) {
              let s = preRollFrame[i];
              if (s > 1) s = 1;
              else if (s < -1) s = -1;
              pcm[i] = Math.round(s * 32767);
            }
            this.sendAudioChunk(
              pcm,
              this.chunkCaptureStartMs,
              (pcm.length / 16000) * 1000,
              {
                rms_dbfs: -30,
                peak_dbfs: -10,
                estimated_snr_db: 15,
                clipping_ratio: 0,
              },
            );
          }
        }
        break;
      }

      case "speech_end":
        this.utteranceManager.handleSpeechEnd(event, currentSeq);
        break;

      case "speech_continue":
        this.log("Speech resumed after pause");
        break;
    }
  }

  private flushChunkBuffer(_currentTimestampMs: number): void {
    if (this.chunkBuffer.length === 0) return;

    // Merge buffered Int16 frames into one
    const totalSamples = this.chunkBuffer.reduce(
      (sum, buf) => sum + buf.length,
      0,
    );
    const merged = new Int16Array(totalSamples);
    let offset = 0;
    for (const buf of this.chunkBuffer) {
      merged.set(buf, offset);
      offset += buf.length;
    }

    // Average quality across grouped frames
    const avgQuality = this.averageQuality(this.chunkQualityBuffer);
    const durationMs = (totalSamples / 16000) * 1000;

    // Only send if there's an active utterance
    if (this.utteranceManager.isActive()) {
      this.sendAudioChunk(
        merged,
        this.chunkCaptureStartMs,
        durationMs,
        avgQuality,
      );
    }

    this.chunkBuffer = [];
    this.chunkQualityBuffer = [];
  }

  private sendAudioChunk(
    pcm: Int16Array,
    captureStartMs: number,
    durationMs: number,
    quality: AudioQuality,
  ): void {
    const utteranceId = this.utteranceManager.getCurrentUtteranceId();
    if (!utteranceId) return;

    const utteranceSeq = this.utteranceManager.trackChunk(quality);
    if (utteranceSeq === null) return;

    const speakerId = this.config.speakerId;
    const speakerState: SpeakerState = speakerId ? "assigned" : "unknown";
    const vadState = this.vad.getState();

    this.transport.sendAudioChunk(
      {
        participant_id: this.config.participantId,
        speaker_id: speakerId,
        speaker_state: speakerState,
        utterance_id: utteranceId,
        utterance_sequence: utteranceSeq,
        capture_start_ms: Math.round(captureStartMs),
        duration_ms: Math.round(durationMs),
        audio: {
          codec: "pcm_s16le",
          sample_rate_hz: 16000,
          channels: 1,
          payload_bytes: pcm.byteLength,
        },
        speech: {
          vad_probability:
            vadState === "SPEAKING" || vadState === "POSSIBLE_END" ? 0.9 : 0.1,
          overlap: false,
          active_speaker_ids: speakerId ? [speakerId] : [],
        },
        processing: {
          aec_applied: true,
          noise_suppression_applied: true,
          agc_applied: true,
          resampled: true,
        },
        quality: {
          rms_dbfs: quality.rms_dbfs,
          peak_dbfs: quality.peak_dbfs,
          estimated_snr_db: quality.estimated_snr_db,
          clipping_ratio: quality.clipping_ratio,
        },
      },
      pcm,
    );

    this.totalChunksSent++;
    this.totalAudioDurationMs += durationMs;
    this.events.onChunkSent?.(this.transport.getCurrentSequence());
  }

  private averageQuality(samples: AudioQuality[]): AudioQuality {
    if (samples.length === 0) {
      return {
        rms_dbfs: -96,
        peak_dbfs: -96,
        estimated_snr_db: 0,
        clipping_ratio: 0,
      };
    }
    let rms = 0,
      peak = -Infinity,
      snr = 0,
      clip = 0;
    for (const s of samples) {
      rms += s.rms_dbfs;
      if (s.peak_dbfs > peak) peak = s.peak_dbfs;
      snr += s.estimated_snr_db;
      clip = Math.max(clip, s.clipping_ratio);
    }
    return {
      rms_dbfs: rms / samples.length,
      peak_dbfs: peak,
      estimated_snr_db: snr / samples.length,
      clipping_ratio: clip,
    };
  }

  private log(message: string): void {
    this.events.onLog?.(message);
  }
}
