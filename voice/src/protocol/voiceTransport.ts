import type {
  AudioChunkPartial,
  ConnectionState,
  UtteranceEndPartial,
  UtteranceStartPartial,
  VoiceStreamClientConfig,
  VoiceStreamClientEvents,
} from './wsClient';

export interface VoiceTransport {
  connect(): Promise<void>;
  disconnect(): void;
  getCurrentSequence(): number;
  getState(): ConnectionState;
  sendAudioChunk(partial: AudioChunkPartial, payload: Int16Array): void;
  sendUtteranceEnd(partial: UtteranceEndPartial): void;
  sendUtteranceStart(partial: UtteranceStartPartial): void;
}

export type VoiceTransportFactory = (
  config: VoiceStreamClientConfig,
  events: VoiceStreamClientEvents,
) => VoiceTransport;
