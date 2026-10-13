/** All times are seconds on the captured audio sample clock, never callback time. */
export interface DetectedOnset {
  time: number;
  strength: number;
  confidence: number;
}

/**
 * A small, causal transient detector for mono microphone PCM.
 *
 * Local energy contrast rejects gradual background changes and sustained tails. It is not
 * source separation: quiet ghost notes masked by loud cymbals can be missed.
 * Analysis windows are approximately 2.7 ms; reported timestamps point into the
 * captured window, independent of delivery jitter or the UI frame rate. The
 * first ~32 ms after activation/reset establish background energy without hits.
 */
export class OnsetDetector {
  private sampleRate = 0;
  private window = new Float32Array(128);
  private filled = 0;
  private windowTime = 0;
  private expectedTime: number | null = null;
  private previousRms = 0;
  private noiseFloor = 0.0005;
  private lastOnsetTime = -Infinity;
  private recentPeak = 0;
  private armed = true;
  private analyzedThrough: number | null = null;
  // Compare attack energy with ~32 ms of preceding audio, not just a single
  // waveform trough. A car/low note can rise sharply within one 2.7 ms window.
  private readonly energyHistory = new Float64Array(12);
  private historyIndex = 0;
  private historyCount = 0;
  private historyEnergy = 0;

  /** Safe clock watermark: no attack before this time remains buffered. */
  get processedThrough(): number | null { return this.analyzedThrough; }

  reset(): void {
    this.sampleRate = 0;
    this.filled = 0;
    this.expectedTime = null;
    this.previousRms = 0;
    this.noiseFloor = 0.0005;
    this.lastOnsetTime = -Infinity;
    this.recentPeak = 0;
    this.armed = true;
    this.analyzedThrough = null;
    this.energyHistory.fill(0);
    this.historyIndex = 0;
    this.historyCount = 0;
    this.historyEnergy = 0;
  }

  process(samples: Float32Array, startTimeSeconds: number, sampleRate: number): DetectedOnset[] {
    if (!Number.isFinite(startTimeSeconds) || !Number.isFinite(sampleRate) || sampleRate < 8000) {
      throw new RangeError('PCM requires a finite capture timestamp and a sample rate of at least 8 kHz.');
    }
    if (sampleRate !== this.sampleRate || (this.expectedTime !== null && Math.abs(startTimeSeconds - this.expectedTime) > 2 / sampleRate)) {
      this.reset();
      this.sampleRate = sampleRate;
      this.window = new Float32Array(Math.max(32, Math.round(sampleRate * 0.002667)));
    }
    const onsets: DetectedOnset[] = [];
    for (let i = 0; i < samples.length; i += 1) {
      if (this.filled === 0) this.windowTime = startTimeSeconds + i / sampleRate;
      const value = samples[i];
      this.window[this.filled++] = Number.isFinite(value) ? value : 0;
      if (this.filled === this.window.length) {
        const onset = this.analyze();
        this.analyzedThrough = this.windowTime + this.window.length / this.sampleRate;
        if (onset) onsets.push(onset);
        this.filled = 0;
      }
    }
    this.expectedTime = startTimeSeconds + samples.length / sampleRate;
    return onsets;
  }

  private analyze(): DetectedOnset | null {
    let energy = 0;
    let peak = 0;
    for (const sample of this.window) {
      energy += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    const meanEnergy = energy / this.window.length;
    const rms = Math.sqrt(meanEnergy);
    const backgroundRms = Math.sqrt(Math.max(0, this.historyEnergy) / Math.max(1, this.historyCount));
    const backgroundReady = this.historyCount === this.energyHistory.length;
    this.historyEnergy += meanEnergy - this.energyHistory[this.historyIndex];
    this.energyHistory[this.historyIndex] = meanEnergy;
    this.historyIndex = (this.historyIndex + 1) % this.energyHistory.length;
    this.historyCount = Math.min(this.historyCount + 1, this.energyHistory.length);
    const previous = this.previousRms;
    const floor = Math.max(0.006, this.noiseFloor * 2.5);
    const rise = rms - previous;
    const ratio = rms / Math.max(previous, floor);
    const contrast = rms / Math.max(backgroundRms, floor);
    if (rms < this.recentPeak * 0.7) this.armed = true;
    // Let the floor fall relatively quickly in silence, rise slowly in sound.
    this.noiseFloor += (rms - this.noiseFloor) * (rms < this.noiseFloor ? 0.03 : 0.0005);
    this.previousRms = rms;
    this.recentPeak = Math.max(rms, this.recentPeak * 0.99);
    const elapsed = this.windowTime - this.lastOnsetTime;
    if (!backgroundReady || elapsed < 0.018 || (!this.armed && ratio < 2.5) || rms < floor || rise < 0.002 || ratio < 1.55 || contrast < 1.8) return null;

    // Back within this captured window to the attack, instead of stamping its end.
    let offset = 0;
    const attackThreshold = Math.max(peak * 0.25, previous * 2);
    while (offset < this.window.length - 1 && Math.abs(this.window[offset]) < attackThreshold) offset += 1;
    const time = this.windowTime + offset / this.sampleRate;
    this.lastOnsetTime = time;
    this.armed = false;
    this.recentPeak = Math.max(this.recentPeak, rms);
    return {
      time,
      strength: Math.min(1, peak),
      confidence: Math.min(0.98, Math.max(0.35, 0.45 + Math.log2(ratio) * 0.15 + Math.min(0.2, rise * 2))),
    };
  }
}
