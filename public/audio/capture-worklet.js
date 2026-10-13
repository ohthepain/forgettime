// Real microphone PCM, never a simulated onset source. No main-thread time is used.
class ForgettimeCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(1024);
    this.used = 0;
    this.startFrame = 0;
    this.expectedFrame = undefined;
    this.inGap = false;
  }

  process(inputs) {
    const channels = inputs[0];
    const hasInput = channels?.[0]?.length > 0;
    if (!hasInput || (this.expectedFrame !== undefined && currentFrame !== this.expectedFrame)) {
      // Empty input is not captured silence. Never join PCM across a missing
      // render quantum (including a gap inside a partly filled batch).
      this.used = 0;
      if (this.expectedFrame !== undefined && !this.inGap) {
        this.port.postMessage({ type: 'gap' });
        this.inGap = true;
      }
      this.expectedFrame = undefined;
    }
    if (!hasInput) return true;
    const length = channels[0].length;
    this.expectedFrame = currentFrame + length;
    this.inGap = false;
    for (let i = 0; i < length; i++) {
      if (this.used === 0) this.startFrame = currentFrame + i;
      // Use the first requested mono channel. Averaging stereo can cancel transients.
      this.samples[this.used++] = channels[0][i];
      if (this.used === this.samples.length) {
        const samples = this.samples;
        this.port.postMessage({ type: 'samples', samples, startFrame: this.startFrame, sampleRate }, [samples.buffer]);
        this.samples = new Float32Array(1024);
        this.used = 0;
      }
    }
    // The output stays zero: monitoring the mic would create acoustic feedback.
    return true;
  }
}
registerProcessor('forgettime-capture', ForgettimeCaptureProcessor);
