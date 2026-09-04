/**
 * AudioWorkletProcessor for Glitch-Free 16kHz PCM Audio Streaming
 * Runs directly on Web Audio rendering thread to avoid main UI thread latency/jank.
 */
class PcmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetSampleRate = 16000;
    this.bufferSize = 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
    
    this.port.onmessage = (event) => {
      if (event.data.type === 'set_sample_rate') {
        this.targetSampleRate = event.data.sampleRate || 16000;
      }
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const channelData = input[0];
    if (!channelData || channelData.length === 0) return true;

    for (let i = 0; i < channelData.length; i++) {
      this.buffer[this.bufferIndex++] = channelData[i];

      if (this.bufferIndex >= this.bufferSize) {
        this.flushBuffer();
      }
    }

    return true;
  }

  flushBuffer() {
    const float32Chunk = this.buffer.subarray(0, this.bufferIndex);
    const inRate = sampleRate; // Global AudioWorklet sampleRate
    const outRate = this.targetSampleRate;

    // Compute RMS audio level for UI visualizers
    let sum = 0;
    for (let i = 0; i < float32Chunk.length; i++) {
      sum += float32Chunk[i] * float32Chunk[i];
    }
    const rms = Math.sqrt(sum / float32Chunk.length);
    const level = Math.min(100, Math.floor(rms * 500));

    // Linear Interpolation Resampler: Float32 (inRate) -> Int16 PCM (16000 Hz)
    const ratio = inRate / outRate;
    const newLength = Math.round(float32Chunk.length / ratio);
    const pcmInt16 = new Int16Array(newLength);

    for (let i = 0; i < newLength; i++) {
      const originPos = i * ratio;
      const index = Math.floor(originPos);
      const decimal = originPos - index;

      const current = float32Chunk[index] || 0;
      const next = float32Chunk[index + 1] !== undefined ? float32Chunk[index + 1] : current;

      const interpolated = current + (next - current) * decimal;
      const boosted = interpolated * 5.0; // Boost soft microphone input volume (14dB gain)
      const clamped = Math.max(-1, Math.min(1, boosted));
      pcmInt16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }

    // Transfer Int16 PCM ArrayBuffer back to main thread
    this.port.postMessage({
      type: 'pcm_data',
      pcmBuffer: pcmInt16.buffer,
      audioLevel: level
    }, [pcmInt16.buffer]);

    this.bufferIndex = 0;
  }
}

registerProcessor('pcm-processor', PcmProcessor);
