// Real microphone PCM, never a simulated onset source. No main-thread time is used.
class ForgettimeCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(1024);
    this.used = 0;
    this.startFrame = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels || channels.length === 0) return true;
    const length = channels[0].length;
    for (let i = 0; i < length; i++) {
      if (this.used === 0) this.startFrame = currentFrame + i;
      // Use the first requested mono channel. Averaging stereo can cancel transients.
      this.samples[this.used++] = channels[0][i];
      if (this.used === this.samples.length) {
        const samples = this.samples;
        this.port.postMessage({ samples, startFrame: this.startFrame, sampleRate }, [samples.buffer]);
        this.samples = new Float32Array(1024);
        this.used = 0;
      }
    }
    // The output stays zero: monitoring the mic would create acoustic feedback.
    return true;
  }
}
registerProcessor('forgettime-capture', ForgettimeCaptureProcessor);
