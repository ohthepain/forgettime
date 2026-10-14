import type { DetectedOnset } from './onset-detector'
import type { TimingSnapshot } from './engine'
import type { WaveformEnvelope } from './waveform-envelope'

export const WAVEFORM_COLUMNS = 512
export const HIT_STRENGTH_COLORS = [
  { label: 'Soft', color: '#69b7ff', below: 0.08 },
  { label: 'Medium', color: '#b891f2', below: 0.2 },
  { label: 'Firm', color: '#f27781', below: 0.4 },
  { label: 'Strong', color: '#f5a45d', below: 0.7 },
  { label: 'Hard', color: '#f4d66b', below: Infinity },
] as const
export function hitStrengthColor(strength: number) {
  return HIT_STRENGTH_COLORS.find(band => strength < band.below)?.color ?? HIT_STRENGTH_COLORS[4].color
}
export interface WaveformMark { time: number; position: number; strength: number; confidence: number }
export interface BarWaveformSnapshot {
  min: number[]
  max: number[]
  hits: WaveformMark[]
  progress: number | null
  available: boolean
  review: 'complete' | 'partial' | null
}
export const emptyWaveform = (): BarWaveformSnapshot => ({ min: [], max: [], hits: [], progress: null, available: false, review: null })

/** Two bars of display envelopes plus one held display, never recorded audio. A short pre-roll preserves
 * an opening attack whose detector window completes in the next capture batch. */
export class BarWaveformBuffer {
  private envelopes: WaveformEnvelope[] = []
  private hits: DetectedOnset[] = []
  private origin: number | null = null
  private barSeconds = 0
  private available = false
  private view = emptyWaveform()
  private completedEnd = 0
  private playedBar: BarWaveformSnapshot | null = null
  private latestTime = 0
  private lastHitTime: number | null = null

  reset(): BarWaveformSnapshot {
    this.envelopes = []
    this.hits = []
    this.origin = null
    this.available = false
    this.view = emptyWaveform()
    this.completedEnd = 0
    this.playedBar = null
    this.lastHitTime = null
    return this.view
  }

  /** Prefer a bar completed while the drummer was still playing, not the
   * trailing bar which filled with silence while waiting for the timeout. */
  hold(): BarWaveformSnapshot {
    if (this.view.review) return this.view
    if (this.origin === null) return this.view
    this.view = this.playedBar ?? { ...this.render(this.latestTime, this.origin, this.origin, true), review: 'partial' }
    this.origin = null
    this.envelopes = []
    this.hits = []
    return this.view
  }

  addFrame(time: number, points: WaveformEnvelope[] | undefined, hits: DetectedOnset[], state: TimingSnapshot): BarWaveformSnapshot {
    // Keep the held view until a fresh performance starts. Collect only a short
    // pre-roll in the meantime so its first attack survives packet boundaries.
    if (state.status !== 'playing' && this.origin === null) {
      this.envelopes = [...this.envelopes, ...(points ?? [])].filter(point => point.time + point.duration >= time - 0.05)
      return this.view
    }
    const origin = state.phaseOrigin ?? (state.status === 'paused' ? this.origin : null)
    if (origin === null) return this.view
    const bar = 240 / state.bpm
    if (origin !== this.origin || bar !== this.barSeconds) {
      this.hits = []
      this.envelopes = this.envelopes.filter(point => point.time + point.duration > origin)
      this.available = false
      this.origin = origin
      this.barSeconds = bar
      this.completedEnd = 0
      this.playedBar = null
      this.lastHitTime = null
    }
    this.latestTime = time
    if (points !== undefined) this.available = true
    this.envelopes = [...this.envelopes, ...(points ?? [])]
    this.hits = [...this.hits, ...hits].filter(hit => hit.time >= origin && hit.time <= time + 1e-8)
    const last = this.hits.at(-1)?.time
    this.lastHitTime = state.lastHitTime ?? last ?? this.lastHitTime ?? origin
    // Select the last completed bar before the final attack. This also works
    // when one delivery spans a bar boundary or contains delayed onsets.
    const completedEnd = origin + Math.floor((Math.min(time, this.lastHitTime) - origin + 1e-8) / bar) * bar
    if (completedEnd > origin && completedEnd > this.completedEnd) {
      const start = completedEnd - bar
      const view = this.render(completedEnd, start, start, true)
      if (view.hits.length) this.playedBar = { ...view, review: 'complete' }
      this.completedEnd = completedEnd
    }
    // Hold before trimming: the timeout frame may arrive more than one bar
    // after the final hit. Only compact display envelopes are retained.
    if (state.status === 'paused') return this.hold()
    const cutoff = Math.max(origin, time - bar)
    this.view = this.render(time, origin, cutoff)
    this.envelopes = this.envelopes.filter(point => point.time + point.duration > time - 2 * bar)
    this.hits = this.hits.filter(hit => hit.time >= time - 2 * bar)
    return this.view
  }

  private render(time: number, origin: number, cutoff: number, held = false): BarWaveformSnapshot {
    const bar = this.barSeconds
    if (held) time = Math.min(time, origin + bar)
    const min = Array<number>(WAVEFORM_COLUMNS).fill(0)
    const max = Array<number>(WAVEFORM_COLUMNS).fill(0)
    const generations = Array<number>(WAVEFORM_COLUMNS).fill(-Infinity)
    const width = bar / WAVEFORM_COLUMNS
    // A column is cleared when the current sweep enters it, even for silence.
    // A segment straddling beat 1 is split between the two edges, never stretched.
    for (const point of this.envelopes) {
      const from = Math.max(point.time, cutoff)
      const to = Math.min(point.time + point.duration, time)
      if (to <= from) continue
      const first = Math.floor((from - origin) / width + 1e-8)
      const last = Math.ceil((to - origin) / width - 1e-8) - 1
      for (let column = first; column <= last; column++) {
        const index = column % WAVEFORM_COLUMNS
        if (column > generations[index]) { min[index] = 1; max[index] = -1; generations[index] = column }
        if (column === generations[index]) {
          min[index] = Math.min(min[index], Math.max(-1, point.min))
          max[index] = Math.max(max[index], Math.min(1, point.max))
        }
      }
    }
    const position = (t: number) => {
      const bars = Math.max(0, (t - origin) / bar)
      return Math.max(0, bars - Math.floor(bars + 1e-9))
    }
    return { min, max, available: this.available, progress: held ? Math.min(1, (time - origin) / bar) : position(time), review: null,
      hits: this.hits.filter(hit => held ? hit.time >= cutoff && (hit.time < time || (time < origin + bar && hit.time === time)) : hit.time > time - bar + 1e-8)
        .map(hit => ({ ...hit, position: position(hit.time) })) }
  }
}
