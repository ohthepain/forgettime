// Real microphone PCM, never a simulated onset source. No main-thread time is used.
class ForgettimeCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(1024);
    this.used = 0;
    this.startFrame = 0;
    this.expectedFrame = undefined;
    this.inGap = false;
    this.metronome = null;
    this.metronomeKey = null;
    this.metronomeStarting = false;
    this.port.onmessage = ({ data }) => {
      if (data.type !== 'metronome') return;
      const key = data.plan ? `${data.plan.origin}/${data.plan.bpm}/${data.plan.fromBeat}` : null;
      const previous = this.metronome;
      this.metronome = data.plan ? { ...data.plan } : null;
      if (key !== this.metronomeKey) this.metronomeStarting = true;
      else if (previous && this.metronome) this.metronome.fromBeat = Math.max(previous.fromBeat, this.metronome.fromBeat);
      this.metronomeKey = key;
    };
  }

  process(inputs, outputs = []) {
    const channels = inputs[0];
    const hasInput = channels?.[0]?.length > 0;
    if (!hasInput || (this.expectedFrame !== undefined && currentFrame !== this.expectedFrame)) {
      // Empty input is not captured silence. Never join PCM across a missing
      // render quantum (including a gap inside a partly filled batch).
      this.used = 0;
      this.metronome = null;
      this.metronomeKey = null;
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
    // Only synthesize the click; microphone PCM is NEVER routed to the speaker.
    const plan = this.metronome;
    if (plan && this.metronomeStarting) {
      // A bridge/port message can arrive after its first click deadline. Skip
      // that click instead of beginning halfway through its sound envelope.
      plan.fromBeat = Math.max(plan.fromBeat, Math.ceil((currentFrame / sampleRate - plan.origin) / (60 / plan.bpm) - 1e-9));
      this.metronomeStarting = false;
    }
    for (const output of outputs[0] ?? []) {
      output.fill(0);
      if (!plan) continue;
      const beat = 60 / plan.bpm;
      for (let i = 0; i < output.length; i++) {
        const time = (currentFrame + i) / sampleRate;
        const index = Math.floor((time - plan.origin) / beat + 1e-9);
        const age = time - (plan.origin + index * beat);
        if (index < plan.fromBeat || time >= plan.untilTime || age < 0 || age >= 0.025) continue;
        const accent = index % 4 === 0;
        output[i] = (accent ? 0.3 : 0.22) * Math.sin(2 * Math.PI * (accent ? 1500 : 1000) * age)
          * Math.min(1, age / 0.001) * Math.exp(-age * 180) * Math.min(1, (0.025 - age) / 0.004);
      }
    }
    return true;
  }
}
registerProcessor('forgettime-capture', ForgettimeCaptureProcessor);
