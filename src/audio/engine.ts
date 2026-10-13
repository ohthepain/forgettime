import type { DetectedOnset } from './onset-detector';

export type InterpretationMode = 'auto' | 'straight' | 'swing';
export type Subdivision = 'quarter' | 'eighth' | 'sixteenth' | 'triplet' | 'sextuplet';
export type TrackingStatus = 'idle' | 'listening' | 'finding' | 'playing' | 'paused';
export interface TimingOptions { bpm: number; mode?: InterpretationMode }
export interface ResolvedHit {
  id: number;
  time: number;
  errorMs: number | null;
  confidence: number;
  subdivision: Subdivision;
  uncertain: boolean;
  reason?: string;
  /** Start of the one-second display lifetime, on the capture clock. */
  displayedAt: number;
}
export interface TimingSnapshot {
  status: TrackingStatus;
  bpm: number;
  mode: InterpretationMode;
  beat: 1 | 2 | 3 | 4 | null;
  phaseOrigin: number | null;
  hits: ResolvedHit[];
  pendingCount: number;
  lockConfidence: number;
}

interface Candidate { name: Subdivision; divisions: number; complexity: number }
interface PendingHit extends DetectedOnset { id: number; ambiguous?: string }
interface CandidateFit { candidate: Candidate; cost: number; errors: number[] }
const CANDIDATES: Candidate[] = [
  { name: 'quarter', divisions: 1, complexity: 0 },
  { name: 'eighth', divisions: 2, complexity: 2.5 },
  { name: 'triplet', divisions: 3, complexity: 4 },
  { name: 'sixteenth', divisions: 4, complexity: 5 },
  { name: 'sextuplet', divisions: 6, complexity: 8 },
];
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** A locked, selected-tempo clock. Neither BPM nor phase follows subsequent drift. */
export class TimingEngine {
  private bpm: number;
  private mode: InterpretationMode;
  private status: TrackingStatus = 'idle';
  private phaseOrigin: number | null = null;
  private lockConfidence = 0;
  private lastHit: number | null = null;
  private opening: PendingHit[] = [];
  private pending: PendingHit[] = [];
  private context: PendingHit[] = [];
  private resolved: ResolvedHit[] = [];
  private preferred: Subdivision = 'quarter';
  private nextId = 1;

  constructor(options: TimingOptions) {
    this.assertBpm(options.bpm);
    this.bpm = options.bpm;
    this.mode = options.mode ?? 'auto';
  }

  start(nowSeconds: number): void {
    this.assertTime(nowSeconds);
    this.clearPerformance();
    this.status = 'listening';
  }

  stop(): void {
    this.clearPerformance();
    this.status = 'idle';
  }

  /** Tempo/mode edits deliberately start a fresh reference. */
  configure(options: Partial<TimingOptions>): void {
    if (options.bpm !== undefined) this.assertBpm(options.bpm);
    const changed = (options.bpm !== undefined && options.bpm !== this.bpm) || (options.mode !== undefined && options.mode !== this.mode);
    this.bpm = options.bpm ?? this.bpm;
    this.mode = options.mode ?? this.mode;
    if (changed) {
      const wasRunning = this.status !== 'idle';
      this.clearPerformance();
      this.status = wasRunning ? 'listening' : 'idle';
    }
  }

  addOnset(onset: DetectedOnset): void {
    this.assertTime(onset.time);
    if (this.status === 'idle' || (this.lastHit !== null && onset.time <= this.lastHit)) return;
    this.advance(onset.time, false);
    if (this.status === 'listening' || this.status === 'paused') {
      this.clearPerformance();
      this.status = 'finding';
    }
    const hit: PendingHit = {
      ...onset,
      strength: clamp(onset.strength, 0, 1),
      confidence: clamp(onset.confidence ?? 0.7, 0, 1),
      id: this.nextId++,
    };
    // Sub-45 ms attacks cannot safely be assigned a precise musical intention.
    if (this.lastHit !== null && hit.time - this.lastHit < 0.045) {
      hit.ambiguous = 'Flam or roll: intended attack is uncertain';
      const previous = this.pending.at(-1) ?? this.opening.at(-1);
      if (previous) previous.ambiguous = hit.ambiguous;
    }
    if (hit.confidence < 0.55) hit.ambiguous ??= 'Weak or masked attack';
    this.lastHit = hit.time;
    if (this.status === 'finding') {
      this.opening.push(hit);
      if (this.opening.length > 24) this.opening.shift();
      this.tryLock();
      return;
    }
    this.pending.push(hit);
    // A short, consistent lookahead lets later attacks inform this interpretation.
    this.resolvePending(hit.time);
  }

  snapshot(nowSeconds: number): TimingSnapshot {
    this.assertTime(nowSeconds);
    this.advance(nowSeconds);
    this.resolved = this.resolved.filter((hit) => nowSeconds - hit.displayedAt < 1);
    let beat: TimingSnapshot['beat'] = null;
    if (this.status === 'playing' && this.phaseOrigin !== null) {
      const index = Math.floor((nowSeconds - this.phaseOrigin + 1e-8) / this.beatSeconds);
      beat = (((index % 4) + 4) % 4 + 1) as 1 | 2 | 3 | 4;
    }
    return {
      status: this.status, bpm: this.bpm, mode: this.mode, beat,
      phaseOrigin: this.phaseOrigin, hits: this.resolved.map((hit) => ({ ...hit })),
      pendingCount: this.pending.length + this.opening.length,
      lockConfidence: this.lockConfidence,
    };
  }

  private get beatSeconds(): number { return 60 / this.bpm; }
  private get candidates(): Candidate[] {
    return CANDIDATES.filter((candidate) => this.mode === 'auto' || (this.mode === 'straight' ? candidate.divisions !== 3 && candidate.divisions !== 6 : candidate.divisions === 1 || candidate.divisions === 3 || candidate.divisions === 6));
  }

  private tryLock(): void {
    const clean = this.opening.filter((hit) => !hit.ambiguous);
    if (clean.length < 6 || clean.at(-1)!.time - clean[0].time < this.beatSeconds * 1.5) return;
    // The first reliable attack is the beat-one anchor. The opening sequence
    // estimates only a small phase correction, never a new tempo.
    const seed = clean[0].time;
    const fits = this.candidates.map((candidate) => {
      const interval = this.beatSeconds / candidate.divisions;
      const residuals = clean.map((hit) => this.error(hit.time, seed, interval));
      const correction = median(residuals);
      const errors = residuals.map((error) => error - correction);
      const rmsMs = Math.sqrt(errors.reduce((total, value) => total + value * value, 0) / errors.length) * 1000;
      return { candidate, correction, rmsMs, cost: rmsMs + candidate.complexity };
    }).sort((a, b) => a.cost - b.cost);
    const best = fits[0];
    const toleranceMs = Math.min(32, this.beatSeconds * 80);
    if (best.rmsMs > toleranceMs) return;
    this.phaseOrigin = seed + best.correction;
    this.lockConfidence = clamp(1 - best.rmsMs / (toleranceMs * 2), 0.5, 1);
    this.preferred = best.candidate.name;
    this.status = 'playing';
    // Initial hits establish the reference; scoring them would manufacture accuracy.
    this.context = clean.slice(-4);
    this.opening = [];
  }

  private advance(now: number, resolve = true): void {
    if (this.status === 'idle' || this.lastHit === null) return;
    // Timeout is elapsed duration from the last attack, including during finding.
    if (now - this.lastHit >= this.beatSeconds * 4 - 1e-9) {
      if (this.pending.length) this.resolvePending(now);
      this.status = 'paused';
      this.phaseOrigin = null;
      this.lockConfidence = 0;
      this.opening = [];
      this.context = [];
      return;
    }
    if (resolve && this.status === 'playing' && this.pending.length && now - this.pending[0].time >= 0.24) {
      this.resolvePending(now);
    }
  }

  private resolvePending(now: number): void {
    if (this.phaseOrigin === null || !this.pending.length) return;
    // Present each attack after the same lookahead, keeping successive marks
    // visually ordered and exposing flams before committing the first mark.
    // Resolved marks are never moved or retrospectively rescored.
    const resolveCount = this.pending.filter((hit) => now - hit.time >= 0.24 - 1e-9).length;
    if (!resolveCount) return;
    const sequence = [...this.context.slice(-4), ...this.pending];
    const fits: CandidateFit[] = this.candidates.map((candidate) => {
      const interval = this.beatSeconds / candidate.divisions;
      const errors = sequence.map((hit) => this.error(hit.time, this.phaseOrigin!, interval) * 1000);
      let weight = 0;
      let loss = 0;
      errors.forEach((error, i) => {
        // Current attacks can introduce a fill; history prevents frame-by-frame switching.
        const currentWeight = i < sequence.length - this.pending.length ? 0.35 : 1;
        const hitWeight = currentWeight * (sequence[i].ambiguous ? 0.15 : 1);
        weight += hitWeight;
        loss += Math.min(100, Math.abs(error)) * hitWeight;
      });
      return {
        candidate, errors,
        cost: loss / Math.max(weight, 1) + candidate.complexity + (candidate.name === this.preferred ? 0 : 3)
          + this.unsupportedSubdivisionPenalty(candidate, sequence),
      };
    }).sort((a, b) => a.cost - b.cost);
    const best = fits[0];
    const intervalMs = this.beatSeconds * 1000 / best.candidate.divisions;
    const pendingOffset = sequence.length - this.pending.length;
    this.pending.slice(0, resolveCount).forEach((hit, i) => {
      const errorMs = best.errors[pendingOffset + i];
      // Equivalent predictions on nested grids are not ambiguous. Competing
      // straight/triplet interpretations that disagree materially are.
      const competing = fits.slice(1).find((fit) => Math.abs(fit.errors[pendingOffset + i] - errorMs) > 12);
      const ambiguousGrid = competing !== undefined && competing.cost - best.cost < 5;
      const tooFar = Math.abs(errorMs) > Math.min(70, intervalMs * 0.38);
      const reason = hit.ambiguous ?? (ambiguousGrid ? 'Rhythmic subdivision is ambiguous' : tooFar ? 'Attack falls between plausible subdivisions' : undefined);
      const confidence = reason ? Math.min(hit.confidence, 0.45) : clamp(hit.confidence * (1 - Math.abs(errorMs) / intervalMs), 0, 1);
      this.resolved.push({
        id: hit.id, time: hit.time,
        errorMs: reason ? null : errorMs,
        confidence, subdivision: best.candidate.name,
        uncertain: Boolean(reason), reason, displayedAt: now,
      });
    });
    this.resolved = this.resolved.slice(-128);
    this.preferred = best.candidate.name;
    this.context = sequence.slice(0, pendingOffset + resolveCount).slice(-4);
    this.pending = this.pending.slice(resolveCount);
  }

  private error(time: number, origin: number, interval: number): number {
    const position = (time - origin) / interval;
    return (position - Math.round(position)) * interval;
  }

  private unsupportedSubdivisionPenalty(candidate: Candidate, sequence: PendingHit[]): number {
    if (candidate.divisions === 1 || candidate.name === this.preferred) return 0;
    // A finer grid needs evidence in the *spacing* of attacks. Absolute lateness
    // alone must never make quarter notes turn into perfectly timed sixteenths.
    // Missing notes are allowed: an interval can span any integer number of steps.
    const step = this.beatSeconds / candidate.divisions;
    const tolerance = Math.min(0.025, step * 0.18);
    let evidence = 0;
    let characteristicEvidence = 0;
    for (let i = 1; i < sequence.length; i += 1) {
      if (sequence[i].ambiguous || sequence[i - 1].ambiguous) continue;
      const gap = sequence[i].time - sequence[i - 1].time;
      const steps = Math.round(gap / step);
      if (steps < 1 || Math.abs(gap - steps * step) > tolerance) continue;
      // An eighth-note spacing does not justify choosing the sixteenth grid;
      // likewise, quarter-note spacing supplies no subdivision evidence.
      const denominator = candidate.divisions;
      const isCharacteristic = denominator === 4 || denominator === 6
        ? steps % 2 !== 0 && steps % denominator !== 0
        : steps % denominator !== 0;
      if (steps % denominator !== 0) evidence += 1;
      if (isCharacteristic) characteristicEvidence += 1;
    }
    return evidence >= 2 && characteristicEvidence >= 1 ? 0 : 120;
  }

  private clearPerformance(): void {
    this.phaseOrigin = null;
    this.lockConfidence = 0;
    this.lastHit = null;
    this.opening = [];
    this.pending = [];
    this.context = [];
    this.resolved = [];
    this.preferred = 'quarter';
  }

  private assertBpm(bpm: number): void {
    if (!Number.isFinite(bpm) || bpm < 30 || bpm > 300) throw new RangeError('Tempo must be between 30 and 300 BPM.');
  }

  private assertTime(time: number): void {
    if (!Number.isFinite(time)) throw new RangeError('Capture time must be finite.');
  }
}

/** Exactly one second, linear in opacity; call with the same capture clock. */
export function hitOpacity(hit: Pick<ResolvedHit, 'displayedAt'>, nowSeconds: number): number {
  return clamp(1 - (nowSeconds - hit.displayedAt), 0, 1);
}
