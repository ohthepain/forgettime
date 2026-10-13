import type { TimingSnapshot } from './engine'

export type MetronomeMode = 'first-bar' | 'always' | 'need-help'
export interface MetronomeOptions { enabled: boolean; mode: MetronomeMode; thresholdMs: number }
export const DEFAULT_METRONOME: MetronomeOptions = { enabled: true, mode: 'first-bar', thresholdMs: 100 }
export function normalizeHelpThreshold(value: number) { return Math.max(20, Math.min(200, Math.round(value))) }

/** All times use the microphone sample clock. Renderers generate quarter-note clicks. */
export interface MetronomePlan {
  origin: number; bpm: number; fromBeat: number; untilTime: number
  /** Musical cutoff, separate from the short render watchdog for latency compensation. */
  stopTime?: number
}
export interface MetronomeState { plan: MetronomePlan | null; helping: boolean; badBeats: number; goodBeats: number }

/** Count musical beats, never individual attacks. Rests/ambiguous beats break streaks. */
export class MetronomeCoach {
  private origin: number | null = null
  private seen = new Set<number>()
  private beats = new Map<number, { errors: number[]; uncertain: boolean }>()
  private nextBeat = 0
  private bad = 0
  private good = 0
  private helping = false
  private optionsKey = ''
  private fromBeat: number | null = null

  reset() {
    this.origin = null
    this.seen.clear()
    this.beats.clear()
    this.nextBeat = 0
    this.bad = this.good = 0
    this.helping = false
    this.fromBeat = null
  }

  update(snapshot: TimingSnapshot, now: number, options: MetronomeOptions): MetronomeState {
    const key = `${options.enabled}/${options.mode}/${options.thresholdMs}`
    if (key !== this.optionsKey) { this.reset(); this.optionsKey = key }
    const { phaseOrigin: origin, bpm } = snapshot
    if (snapshot.status !== 'playing' || origin === null) {
      this.reset()
      return { plan: null, helping: false, badBeats: 0, goodBeats: 0 }
    }
    const beat = 60 / bpm
    if (this.origin !== origin) {
      this.reset()
      this.origin = origin
      // Editing coaching settings must not retrospectively count old beats.
      this.nextBeat = Math.max(0, Math.floor((now - origin) / beat))
    }
    for (const hit of snapshot.hits) {
      if (this.seen.has(hit.id)) continue
      this.seen.add(hit.id)
      const index = Math.floor(((hit.guidance?.intendedTime ?? hit.time) - origin) / beat + 1e-7)
      if (index < this.nextBeat) continue
      const entry = this.beats.get(index) ?? { errors: [], uncertain: false }
      if (hit.guidance) entry.errors.push(Math.abs(hit.guidance.errorMs))
      else entry.uncertain = true
      this.beats.set(index, entry)
    }
    // Wait for early/late assignments and the engine's 240 ms interpretation window.
    const completeThrough = Math.floor((now - origin - beat / 2 - 0.24) / beat + 1e-7) - 1
    for (; this.nextBeat <= completeThrough; this.nextBeat++) {
      const entry = this.beats.get(this.nextBeat)
      this.beats.delete(this.nextBeat)
      if (!entry?.errors.length || entry.uncertain) { this.bad = this.good = 0; continue }
      const errors = entry.errors.sort((a, b) => a - b)
      const middle = Math.floor(errors.length / 2)
      const median = errors.length % 2 ? errors[middle] : (errors[middle - 1] + errors[middle]) / 2
      if (median > options.thresholdMs + 1e-7) {
        this.bad++; this.good = 0
        if (this.bad >= 4) this.helping = true
      } else {
        this.good++; this.bad = 0
        if (this.good >= 4) this.helping = false
      }
    }
    // Bound deduplication memory without forgetting any still-visible hit.
    this.seen = new Set(snapshot.hits.map(hit => hit.id))
    const firstBarEnd = origin + beat * 4
    const active = options.enabled && (options.mode === 'always' || now < firstBarEnd || (options.mode === 'need-help' && this.helping))
    if (!active) this.fromBeat = null
    else this.fromBeat ??= Math.max(1, Math.ceil((now - origin) / beat + 0.01))
    const stopTime = Math.min(
      (snapshot.lastHitTime ?? now) + beat * 4,
      options.mode === 'first-bar' || (options.mode === 'need-help' && !this.helping) ? firstBarEnd : Infinity,
    )
    // A short renewable lease silences output if capture/JS stops delivering frames.
    const untilTime = Math.min(now + 0.35, stopTime)
    return { plan: active ? { origin, bpm, fromBeat: this.fromBeat!, untilTime, stopTime } : null,
      helping: options.mode === 'need-help' && this.helping, badBeats: this.bad, goodBeats: this.good }
  }
}
