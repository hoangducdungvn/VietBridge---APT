class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.bufferedSamples = 0;
    this.frameSamples = null;
  }

  process(inputs) {
    const channelData = inputs[0]?.[0];
    if (!channelData || channelData.length === 0) return true;
    this.frameSamples ??= Math.round(sampleRate * 0.02);
    this.buffer.push(channelData.slice());
    this.bufferedSamples += channelData.length;

    while (this.bufferedSamples >= this.frameSamples) {
      const frame = new Float32Array(this.frameSamples);
      let offset = 0;
      while (offset < this.frameSamples) {
        const chunk = this.buffer[0];
        const count = Math.min(chunk.length, this.frameSamples - offset);
        frame.set(chunk.subarray(0, count), offset);
        if (count === chunk.length) this.buffer.shift();
        else this.buffer[0] = chunk.subarray(count);
        offset += count;
      }
      this.bufferedSamples -= this.frameSamples;
      this.port.postMessage({ sampleRate, frame }, [frame.buffer]);
    }
    return true;
  }
}

registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
