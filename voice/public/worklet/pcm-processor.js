// AudioWorkletProcessor that slices whatever render-quantum blocks the
// browser hands us (usually 128 samples) into fixed 20ms frames at the
// AudioContext's native sample rate, and posts each frame to the main
// thread as a transferable Float32Array.
//
// Kept as plain JS (no imports, no TypeScript) because AudioWorkletGlobalScope
// does not go through the app's normal module bundler.
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._bufferedSamples = 0;
    this._frameSamples = null;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }
    const channelData = input[0];
    if (!channelData || channelData.length === 0) {
      return true;
    }

    if (this._frameSamples === null) {
      // `sampleRate` is a global available inside AudioWorkletGlobalScope.
      this._frameSamples = Math.round(sampleRate * 0.02); // 20ms
    }

    this._buffer.push(channelData.slice());
    this._bufferedSamples += channelData.length;

    while (this._bufferedSamples >= this._frameSamples) {
      const frame = new Float32Array(this._frameSamples);
      let offset = 0;
      let remaining = this._frameSamples;

      while (remaining > 0) {
        const chunk = this._buffer[0];
        if (chunk.length <= remaining) {
          frame.set(chunk, offset);
          offset += chunk.length;
          remaining -= chunk.length;
          this._buffer.shift();
        } else {
          frame.set(chunk.subarray(0, remaining), offset);
          this._buffer[0] = chunk.subarray(remaining);
          offset += remaining;
          remaining = 0;
        }
      }

      this._bufferedSamples -= this._frameSamples;
      this.port.postMessage({ sampleRate, frame }, [frame.buffer]);
    }

    return true;
  }
}

registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
