import { DEFAULT_DETECTOR_SETTINGS, DETECTOR_VERSION, MAX_DIAGNOSTIC_CANDIDATES, normalizeDetectorSettings, type DetectorSettings, type DetectorCandidate, type DetectorRejectionReason, type DetectorDiagnostics } from './detector-contract'
/** All times are seconds on the captured audio sample clock, never callback time. */
export interface DetectedOnset {
  time: number;
  strength: number;
  confidence: number;
}

/**
 * A small, causal transient detector for mono microphone PCM.
 *
 * A fast-attack, slow-release level reference gates faint sound between hits,
 * without normalizing or compressing the PCM. Local energy contrast rejects
 * gradual background changes and sustained tails. It is not
 * source separation: quiet ghost notes masked by loud cymbals can be missed.
 * Analysis windows are approximately 2.7 ms; reported timestamps point into the
 * captured window, independent of delivery jitter or the UI frame rate. The
 * first ~32 ms after activation/reset establish background energy without hits.
 */
export class OnsetDetector {
  private settings: DetectorSettings;
  private diagnostics: DetectorCandidate[] = [];
  private diagnosticsDropped = 0;
  private nextCandidateId = 1;
  constructor(settings: Partial<DetectorSettings> = DEFAULT_DETECTOR_SETTINGS) { this.settings = normalizeDetectorSettings(settings); }
  /** Live edits preserve detector history; the practice reference is untouched. */
  configure(settings: DetectorSettings) { this.settings = normalizeDetectorSettings(settings); }
  drainDiagnostics(): DetectorDiagnostics {
    const result = { candidates: this.diagnostics, dropped: this.diagnosticsDropped };
    this.diagnostics = []; this.diagnosticsDropped = 0;
    return result;
  }
  private sampleRate = 0;
  private window = new Float32Array(128);
  private filled = 0;
  private windowTime = 0;
  private expectedTime: number | null = null;
  private previousRms = 0;
  private levelReference = 0;
  private levelHoldUntil = -Infinity;
  private lastOnsetTime = -Infinity;
  private lastClearAttackTime = -Infinity;
  private preAttackBackground = 0;
  private recentPeak = 0;
  private envelopeEnergy = 0;
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
    this.diagnostics = [];
    this.diagnosticsDropped = 0;
    this.sampleRate = 0;
    this.filled = 0;
    this.expectedTime = null;
    this.previousRms = 0;
    this.levelReference = 0;
    this.levelHoldUntil = -Infinity;
    this.lastOnsetTime = -Infinity;
    this.lastClearAttackTime = -Infinity;
    this.preAttackBackground = 0;
    this.recentPeak = 0;
    this.envelopeEnergy = 0;
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
    let shortEnergy = 0;
    for (let i = 1; i <= 3; i += 1) {
      shortEnergy += this.energyHistory[(this.historyIndex + this.energyHistory.length - i) % this.energyHistory.length];
    }
    const shortRms = Math.sqrt(shortEnergy / 3);
    const backgroundReady = this.historyCount === this.energyHistory.length;
    this.historyEnergy += meanEnergy - this.energyHistory[this.historyIndex];
    this.energyHistory[this.historyIndex] = meanEnergy;
    this.historyIndex = (this.historyIndex + 1) % this.energyHistory.length;
    this.historyCount = Math.min(this.historyCount + 1, this.energyHistory.length);
    const previous = this.previousRms;
    // Fast attack, slow recovery, without applying gain to the PCM. Hold
    // the recent playing level for 1 s, then release with a 4 s time constant.
    // Derive decay from sample duration, never callback cadence.
    if (this.windowTime >= this.levelHoldUntil) {
      this.levelReference *= Math.exp(-this.window.length / this.sampleRate / this.settings.recoverySeconds);
    }
    if (rms >= this.levelReference * 0.7) {
      this.levelHoldUntil = this.windowTime + 1;
    }
    this.levelReference = Math.max(rms, this.levelReference);
    const floor = this.settings.minimumRms;
    // Loud accents may raise the noise gate only modestly. Otherwise a kick's
    // body masks subsequent, independently rising quiet hi-hat/ghost attacks.
    const minimumLevel = Math.max(floor, Math.min(this.levelReference * 0.05, floor * 2));
    const rise = rms - previous;
    const ratio = rms / Math.max(previous, floor);
    const elapsed = this.windowTime - this.lastOnsetTime;
    // A preceding accent must not mask a softer, distinct follow-up merely
    // because it is still in the 32 ms history. Use the shorter baseline only
    // just after an accepted attack; keep long-history rumble rejection otherwise.
    // Retain the room level before the accent, and do not let follow-ups extend
    // this exception indefinitely (e.g. on successive low-frequency troughs).
    const fullContrast = rms / Math.max(backgroundRms, floor);
    const baseline = this.windowTime - this.lastClearAttackTime < 0.09
      ? Math.min(backgroundRms, Math.max(shortRms, this.preAttackBackground)) : backgroundRms;
    // The shorter history admits softer follow-ups only on a distinct rise;
    // ordinary oscillation in a decaying kick must still pass the full history.
    const effectiveBaseline = fullContrast < this.settings.contrastRatio && ratio < 2.5
      ? backgroundRms : baseline;
    const contrast = rms / Math.max(effectiveBaseline, floor);
    // Smooth energy over 10 ms before rearming: a low-frequency half-cycle
    // trough is not evidence that the evolving attack has ended.
    this.envelopeEnergy += (meanEnergy - this.envelopeEnergy) * (1 - Math.exp(-this.window.length / this.sampleRate / 0.01));
    const envelopeRms = Math.sqrt(this.envelopeEnergy);
    if (envelopeRms < this.recentPeak * 0.7) this.armed = true;
    this.previousRms = rms;
    this.recentPeak = Math.max(envelopeRms, this.recentPeak * 0.99);
    const reasons: DetectorRejectionReason[] = [];
    if (!backgroundReady) reasons.push('warming-up');

    if (elapsed < this.settings.minSeparationMs / 1000) reasons.push('separation');
    // While the smoothed body is still active, only a much clearer new edge
    // may bypass rearming. A modest later kick-body rise remains the same hit.
    if (!this.armed && ratio < 4) reasons.push('rearming');
    if (rms < minimumLevel) reasons.push('level');
    if (rise < 0.002 || ratio < 1.55) reasons.push('rise');
    if (contrast < this.settings.contrastRatio) reasons.push('contrast');
    // Timestamp both accepted and rejected attempts at their captured crossing.
    let offset = 0;
    const attackThreshold = Math.max(peak * 0.25, previous * 2);
    while (offset < this.window.length - 1 && Math.abs(this.window[offset]) < attackThreshold) offset += 1;
    const time = this.windowTime + offset / this.sampleRate;
    const confidence = Math.min(0.98, Math.max(0.35, 0.45 + Math.log2(Math.max(ratio, 1e-12)) * 0.15 + Math.min(0.2, rise * 2)));
    // An attempted attack is a distinct rising envelope, including soft attempts
    // below the selected floor. Silence/steady/decaying windows are not candidates.
    if (!reasons.length || (peak >= 0.001 && rise > 0.0001 && rms / Math.max(previous, 0.0001) >= 1.1)) {
      const candidate: DetectorCandidate = { version: DETECTOR_VERSION, id: this.nextCandidateId++, time,
        strength: Math.min(1, peak), confidence, accepted: !reasons.length, reasons, settings: { ...this.settings },
        measurements: { rms, minimumLevel, levelReference: this.levelReference, rise, minimumRise: 0.002,
          ratio, minimumRatio: 1.55, contrast, minimumContrast: this.settings.contrastRatio,
          backgroundRms, baselineRms: effectiveBaseline, armed: this.armed, rearmRatio: 4,
          elapsedMs: Number.isFinite(elapsed) ? elapsed * 1000 : null, minimumSeparationMs: this.settings.minSeparationMs } };
      if (this.diagnostics.length < MAX_DIAGNOSTIC_CANDIDATES) this.diagnostics.push(candidate);
      else this.diagnosticsDropped++;
    }
    if (reasons.length) return null;

    this.lastOnsetTime = time;
    if (fullContrast >= this.settings.contrastRatio) {
      this.lastClearAttackTime = time;
      this.preAttackBackground = backgroundRms;
    }
    this.armed = false;
    // Track this attack's envelope rather than an older accent's peak; that
    // would immediately rearm on the quiet beginning of a slow-building kick.
    this.recentPeak = envelopeRms;
    return {
      time,
      strength: Math.min(1, peak),
      confidence,
    };
  }
}
