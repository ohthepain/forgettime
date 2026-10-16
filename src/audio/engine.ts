import type { DetectedOnset } from './onset-detector';
import { DEFAULT_START_SENSITIVITY, normalizeStartSensitivity, startingStrength } from './start-sensitivity';

export type InterpretationMode = 'auto' | 'straight' | 'swing';
export type Subdivision = 'quarter' | 'eighth' | 'sixteenth' | 'triplet' | 'sextuplet';
export type TrackingStatus = 'idle' | 'listening' | 'playing' | 'paused';
export interface TimingOptions { bpm: number; mode?: InterpretationMode; /** Legacy explicit gate for older integrations. */ startSensitivity?: number; liveMinimumStrength?: number }
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
  /** Coarse coaching estimate, including large errors hidden by the precise meter. */
  guidance?: { intendedTime: number; errorMs: number };
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
  lastHitTime?: number | null;
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

/** A locked, selected-tempo clock. Neither BPM nor phase follows subsequent drift. */
export class TimingEngine {
  private bpm: number;
  private mode: InterpretationMode;
  private startSensitivity: number;
  private liveMinimumStrength?: number;
  private status: TrackingStatus = 'idle';
  private phaseOrigin: number | null = null;
  private lockConfidence = 0;
  private lastHit: number | null = null;
  private pending: PendingHit[] = [];
  private context: PendingHit[] = [];
  private resolved: ResolvedHit[] = [];
  private preferred: Subdivision = 'quarter';
  private nextId = 1;
  private replay = false;

  constructor(options: TimingOptions, private readonly onResolved?: (hit: ResolvedHit) => void) {
    this.assertBpm(options.bpm);
    this.liveMinimumStrength = options.liveMinimumStrength ?? (options.startSensitivity === undefined ? 0 : undefined);
    this.bpm = options.bpm;
    this.mode = options.mode ?? 'auto';
    this.startSensitivity = normalizeStartSensitivity(options.startSensitivity ?? DEFAULT_START_SENSITIVITY);
  }

  start(nowSeconds: number): void {
    this.assertTime(nowSeconds);
    this.clearPerformance();
    this.status = 'listening';
  }

  /** A recorded reference is established before detection; rests never end replay. */
  startReplay(origin: number): void {
    this.assertTime(origin);
    this.clearPerformance();
    this.replay = true;
    this.phaseOrigin = origin;
    this.lockConfidence = 1;
    this.status = 'playing';
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
    // Live sensitivity edits apply immediately without moving the established beat.
    if (options.startSensitivity !== undefined) this.startSensitivity = normalizeStartSensitivity(options.startSensitivity);
    if (changed) {
      const wasRunning = this.status !== 'idle';
      this.clearPerformance();
      this.status = wasRunning ? 'listening' : 'idle';
    }
  }

  addOnset(onset: DetectedOnset): void {
    this.assertTime(onset.time);
    if (this.status === 'idle' || !Number.isFinite(onset.strength) || !Number.isFinite(onset.confidence)
      || (this.lastHit !== null && onset.time <= this.lastHit)) return;
    this.advance(onset.time, false);
    // One shared live gate for browser and native onsets. Rejected noise cannot
    // score, influence rhythm interpretation, or extend the silence deadline.
    // Replay has its own detector controls and bypasses this live input gate.
    if (!this.replay && onset.strength < (this.liveMinimumStrength ?? startingStrength(this.startSensitivity))) return;
    if (this.status === 'listening' || this.status === 'paused') {
      if (onset.confidence < 0.55) return;
      this.clearPerformance();
      this.phaseOrigin = onset.time;
      this.lastHit = onset.time;
      this.lockConfidence = clamp(onset.confidence, 0, 1);
      this.status = 'playing';
      this.context = [{ ...onset, id: this.nextId++ }];
      // This hit defines beat 1; scoring it would manufacture a zero error.
      return;
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
      const previous = this.pending.at(-1) ?? this.context.at(-1);
      if (previous) previous.ambiguous = hit.ambiguous;
    }
    if (hit.confidence < 0.55) hit.ambiguous ??= 'Weak or masked attack';
    this.lastHit = hit.time;
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
      pendingCount: this.pending.length,
      lockConfidence: this.lockConfidence,
      lastHitTime: this.lastHit,
    };
  }

  /** Earliest captured-audio time at which the current take may finish. */
  get silenceDeadline(): number | null {
    return !this.replay && this.status === 'playing' && this.lastHit !== null ? this.lastHit + this.beatSeconds * 4 : null;
  }

  private get beatSeconds(): number { return 60 / this.bpm; }
  private get candidates(): Candidate[] {
    return CANDIDATES.filter((candidate) => this.mode === 'auto' || (this.mode === 'straight' ? candidate.divisions !== 3 && candidate.divisions !== 6 : candidate.divisions === 1 || candidate.divisions === 3 || candidate.divisions === 6));
  }

  private advance(now: number, resolve = true): void {
    if (this.status === 'idle' || this.lastHit === null) return;
    // Timeout is elapsed duration from the last accepted attack.
    if (!this.replay && now - this.lastHit >= this.beatSeconds * 4 - 1e-9) {
      if (this.pending.length) this.resolvePending(now);
      this.status = 'paused';
      this.phaseOrigin = null;
      this.lockConfidence = 0;
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
      const result: ResolvedHit = {
        id: hit.id, time: hit.time,
        errorMs: reason ? null : errorMs,
        confidence, subdivision: best.candidate.name,
        uncertain: Boolean(reason), reason, displayedAt: now,
        // Flams, weak attacks and competing rhythms never become coaching evidence.
        guidance: !hit.ambiguous && !ambiguousGrid
          ? { intendedTime: hit.time - errorMs / 1000, errorMs } : undefined,
      };
      this.resolved.push(result);
      this.onResolved?.(result);
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
    this.replay = false;
    this.phaseOrigin = null;
    this.lockConfidence = 0;
    this.lastHit = null;
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
