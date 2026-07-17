// Port for browser audio capture implementations used by listening use-cases.
export interface IAudioStreamRepository {
  start(): Promise<void>;
  stop(): Promise<void>;
  onChunk(callback: (chunk: Blob) => void): () => void;
}
