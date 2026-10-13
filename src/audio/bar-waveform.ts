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
}
export const emptyWaveform = (): BarWaveformSnapshot => ({ min: [], max: [], hits: [], progress: null, available: false })

/** One bar of display envelopes, never recorded audio. A short pre-roll preserves
 * an opening attack whose detector window completes in the next capture batch. */
export class BarWaveformBuffer {
  private envelopes: WaveformEnvelope[] = []
  private hits: DetectedOnset[] = []
  private origin: number | null = null
  private barSeconds = 0
  private available = false
  private view = emptyWaveform()

  reset(): BarWaveformSnapshot {
    this.envelopes = []
    this.hits = []
    this.origin = null
    this.available = false
    this.view = emptyWaveform()
    return this.view
  }

  addFrame(time: number, points: WaveformEnvelope[] | undefined, hits: DetectedOnset[], state: TimingSnapshot): BarWaveformSnapshot {
    const origin = state.phaseOrigin ?? (state.status === 'paused' ? this.origin : null)
    const active = origin !== null && (state.status === 'playing' || state.status === 'paused')
    // Keep at most 50 ms while awaiting an anchor. Gaps/stops explicitly reset.
    if (!active) {
      if (state.status !== 'paused') this.view = emptyWaveform()
      this.envelopes = [...this.envelopes, ...(points ?? [])].filter(point => point.time + point.duration >= time - 0.05)
      this.hits = []
      this.origin = null
      return this.view
    }
    if (origin === null) return this.view
    const bar = 240 / state.bpm
    if (origin !== this.origin || bar !== this.barSeconds) {
      this.hits = []
      this.envelopes = this.envelopes.filter(point => point.time + point.duration > origin)
      this.available = false
      this.origin = origin
      this.barSeconds = bar
    }
    if (points !== undefined) this.available = true
    const cutoff = Math.max(origin, time - bar)
    this.envelopes = [...this.envelopes, ...(points ?? [])].filter(point => point.time + point.duration > cutoff)
    this.hits = [...this.hits, ...hits].filter(hit => hit.time > time - bar + 1e-8 && hit.time >= origin && hit.time <= time + 1e-8)
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
    this.view = { min, max, available: this.available, progress: position(time),
      hits: this.hits.map(hit => ({ ...hit, position: position(hit.time) })) }
    if (state.status === 'paused') this.origin = null // Freeze after the final captured frame.
    return this.view
  }
}
