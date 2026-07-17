import type { IAudioStreamRepository } from '@domain/repositories/IAudioStreamRepository';

// Browser audio adapter wrapping getUserMedia and MediaRecorder for streaming chunks.
export class WebAudioStreamRepository implements IAudioStreamRepository {
  private mediaRecorder?: MediaRecorder;
  private stream?: MediaStream;
  private chunkCallbacks = new Set<(chunk: Blob) => void>();

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });

    this.mediaRecorder = new MediaRecorder(this.stream, { mimeType: 'audio/webm' });
    this.mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) {
        this.chunkCallbacks.forEach((callback) => callback(event.data));
      }
    });
    this.mediaRecorder.start(250);
  }

  async stop() {
    this.mediaRecorder?.stop();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.mediaRecorder = undefined;
    this.stream = undefined;
  }

  onChunk(callback: (chunk: Blob) => void) {
    this.chunkCallbacks.add(callback);
    return () => this.chunkCallbacks.delete(callback);
  }
}
