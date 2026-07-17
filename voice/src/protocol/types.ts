// Wire types for docs/audio-streaming-contract.md v1.3.
// Shared between the browser client and the Node mock ingestion gateway
// (src/mock-server/server.ts) — keep this file free of DOM/Node-only APIs.

export const PROTOCOL_VERSION = '1.3' as const;

export type Platform = 'web' | 'desktop' | 'mobile' | 'embedded';

export type SpeakerState = 'assigned' | 'unknown';

export type LanguageHint = 'vi' | 'en' | 'auto';

export type UtteranceEndReason =
  | 'vad_silence'
  | 'max_duration'
  | 'user_stop'
  | 'source_lost'
  | 'connection_close'
  | 'session_end';

export type NoiseLevel = 'low' | 'moderate' | 'high' | 'severe';

export interface AudioProfile {
  codec: 'pcm_s16le';
  sample_rate_hz: 16000;
  channels: 1;
  chunk_duration_ms: number;
}

export interface EventEnvelope {
  protocol_version: typeof PROTOCOL_VERSION;
  type: string;
  event_id: string;
  session_id: string;
  stream_id: string;
  source_id: string;
  sent_at: string;
}

export interface SessionStartEvent extends EventEnvelope {
  type: 'session.start';
  client: {
    platform: Platform;
    app_version: string;
    sdk_version: string;
    device_id: string;
  };
  audio: AudioProfile;
  capabilities: {
    aec: boolean;
    noise_suppression: boolean;
    agc: boolean;
    vad: boolean;
    resend: boolean;
  };
}

export interface SourceRegisterEvent extends EventEnvelope {
  type: 'source.register';
  participant_id: string;
  speaker_id: string | null;
  speaker_state: SpeakerState;
  language_hint: LanguageHint;
  microphone: {
    label: string;
    channel: number;
  };
}

export interface VadInfo {
  engine: string;
  speech_probability: number;
  pre_roll_ms: number;
}

export interface UtteranceStartEvent extends EventEnvelope {
  type: 'utterance.start';
  utterance_id: string;
  participant_id: string;
  speaker_id: string | null;
  speaker_state: SpeakerState;
  language_hint: LanguageHint;
  start_time_ms: number;
  vad: VadInfo;
  continuation_id?: string;
  continued_from_utterance_id?: string | null;
}

export interface QualitySummary {
  average_snr_db: number;
  clipping_ratio: number;
  dropped_chunks: number;
  noise_level: NoiseLevel;
}

export interface UtteranceEndEvent extends EventEnvelope {
  type: 'utterance.end';
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
}

export interface StreamAckEvent {
  protocol_version: typeof PROTOCOL_VERSION;
  type: 'stream.ack';
  session_id: string;
  stream_id: string;
  highest_contiguous_sequence: number;
  missing_sequences: number[];
  server_time: string;
}

export interface StreamResumeEvent extends EventEnvelope {
  type: 'stream.resume';
  connection_id: string;
  last_acknowledged_sequence: number;
  next_sequence: number;
}

export interface StreamGapEvent {
  protocol_version: typeof PROTOCOL_VERSION;
  type: 'stream.gap';
  session_id: string;
  stream_id: string;
  source_id: string;
  from_sequence: number;
  to_sequence: number;
  start_time_ms: number;
  duration_ms: number;
  reason: string;
}

export interface StreamThrottleEvent {
  protocol_version: typeof PROTOCOL_VERSION;
  type: 'stream.throttle';
  session_id: string;
  stream_id: string;
  level: 'warning';
  estimated_queue_delay_ms: number;
  suggested_action: string;
  server_time: string;
}

export type ErrorCode =
  | 'MICROPHONE_PERMISSION_DENIED'
  | 'MICROPHONE_DISCONNECTED'
  | 'UNSUPPORTED_AUDIO_FORMAT'
  | 'RESAMPLER_FAILURE'
  | 'WEBSOCKET_DISCONNECTED'
  | 'SERVER_BACKPRESSURE'
  | 'PROTOCOL_VERSION_UNSUPPORTED'
  | 'SESSION_NOT_FOUND';

export interface ErrorEvent {
  protocol_version: typeof PROTOCOL_VERSION;
  type: 'error';
  event_id: string;
  session_id: string;
  stream_id?: string;
  source_id?: string;
  code: ErrorCode;
  message: string;
  recoverable: boolean;
  retry_after_ms?: number;
  at_time_ms?: number;
  server_time?: string;
}

export interface HeartbeatPingEvent extends EventEnvelope {
  type: 'heartbeat.ping';
}

export interface HeartbeatPongEvent {
  protocol_version: typeof PROTOCOL_VERSION;
  type: 'heartbeat.pong';
  event_id: string;
  session_id: string;
  stream_id: string;
  in_reply_to: string;
  server_time: string;
}

export interface SpeechInfo {
  vad_probability: number;
  overlap: boolean;
  active_speaker_ids: string[];
}

export interface ProcessingInfo {
  aec_applied: boolean;
  noise_suppression_applied: boolean;
  agc_applied: boolean;
  resampled: boolean;
}

export interface QualityInfo {
  rms_dbfs: number;
  peak_dbfs: number;
  estimated_snr_db: number;
  clipping_ratio: number;
}

export interface AudioChunkMetadata {
  protocol_version: typeof PROTOCOL_VERSION;
  type: 'audio.chunk';
  session_id: string;
  stream_id: string;
  connection_id: string;
  source_id: string;
  participant_id: string;
  speaker_id: string | null;
  speaker_state: SpeakerState;
  utterance_id: string;
  sequence: number;
  utterance_sequence: number;
  capture_start_ms: number;
  duration_ms: number;
  audio: {
    codec: 'pcm_s16le';
    sample_rate_hz: 16000;
    channels: 1;
    payload_bytes: number;
  };
  speech: SpeechInfo;
  processing: ProcessingInfo;
  quality: QualityInfo;
}
