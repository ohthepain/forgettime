import type { DetectedOnset } from './onset-detector'
import type { InterpretationMode, ResolvedHit } from './engine'
import { WAVEFORM_COLUMNS, type BarWaveformSnapshot } from './bar-waveform'

/** Absolute sample positions share the onset clock within one continuous capture. */
export interface CapturedPcm { startFrame: number; samples: Float32Array }
export interface RecordedAudio extends CapturedPcm { sampleRate: number }
export interface TakeSettings { bpm: number; mode: InterpretationMode; startSensitivity: number }
export type TakeEndReason = 'silence' | 'stopped' | 'interrupted' | 'limit'
export interface RecordedTake {
  audio: RecordedAudio
  source: 'web' | 'native'
  /** Identity prevents sample positions being confused across clock resets. */
  continuity: number
  origin: number
  settings: TakeSettings
  onsets: DetectedOnset[]
  results: ResolvedHit[]
  endReason: TakeEndReason
}
export const MAX_TAKE_SECONDS = 120

/** Bounded, on-device latest-take PCM. Never insert silence for missing samples. */
export class TakeRecorder {
  private chunks: CapturedPcm[] = []
  private rate = 0
  private expectedFrame: number | null = null
  private continuity = 0
  private active: Omit<RecordedTake, 'audio' | 'endReason'> | null = null
  private firstFrame = 0
  private endFrame = 0

  get recording() { return this.active !== null }
  get limitTime(): number | null { return this.active ? (this.firstFrame + Math.floor(MAX_TAKE_SECONDS * this.rate)) / this.rate : null }
  get limitReached() { return this.limitTime !== null && this.endFrame / this.rate >= this.limitTime }

  append(pcm: CapturedPcm, sampleRate: number): RecordedTake | null {
    let interrupted: RecordedTake | null = null
    if (this.expectedFrame !== null && (sampleRate !== this.rate || pcm.startFrame !== this.expectedFrame)) {
      interrupted = this.finish('interrupted')
      this.resetContinuity()
    }
    this.rate = sampleRate
    this.expectedFrame = pcm.startFrame + pcm.samples.length
    const limit = this.active ? this.firstFrame + Math.floor(MAX_TAKE_SECONDS * sampleRate) : Infinity
    const length = Math.max(0, Math.min(pcm.samples.length, limit - pcm.startFrame))
    if (length) this.chunks.push({ startFrame: pcm.startFrame, samples: pcm.samples.slice(0, length) })
    this.endFrame = Math.min(this.expectedFrame, limit)
    if (!this.active) {
      // Keep the current packet plus a short prior context for delayed opening attacks.
      const cutoff = pcm.startFrame - Math.ceil(0.1 * sampleRate)
      this.chunks = this.chunks.filter(chunk => chunk.startFrame + chunk.samples.length > cutoff)
    }
    return interrupted
  }

  begin(origin: number, settings: TakeSettings, source: RecordedTake['source']) {
    if (!this.chunks.length) return
    const desired = Math.floor((origin - 0.05) * this.rate)
    this.firstFrame = Math.max(this.chunks[0].startFrame, desired)
    this.active = { origin, settings: { ...settings }, source, continuity: this.continuity, onsets: [], results: [] }
    this.chunks = this.chunks.filter(chunk => chunk.startFrame + chunk.samples.length > this.firstFrame)
  }
  accept(onset: DetectedOnset) { this.active?.onsets.push({ ...onset }) }
  resolve(hit: ResolvedHit) { this.active?.results.push({ ...hit }) }

  finish(endReason: TakeEndReason, endTime = Infinity): RecordedTake | null {
    if (!this.active) return null
    const end = Math.min(this.endFrame, Math.ceil(endTime * this.rate))
    const samples = new Float32Array(Math.max(0, end - this.firstFrame))
    for (const chunk of this.chunks) {
      const from = Math.max(this.firstFrame, chunk.startFrame)
      const to = Math.min(end, chunk.startFrame + chunk.samples.length)
      if (to > from) samples.set(chunk.samples.subarray(from - chunk.startFrame, to - chunk.startFrame), from - this.firstFrame)
    }
    const take = { ...this.active, audio: { sampleRate: this.rate, startFrame: this.firstFrame, samples }, endReason }
    this.active = null
    // A packet may also contain the next take's first hit. Preserve that packet.
    this.chunks = this.chunks.slice(-2)
    return take
  }
  resetContinuity() {
    this.chunks = []
    this.active = null
    this.expectedFrame = null
    this.continuity++
  }
}

export function recordedBarCount(take: RecordedTake): number {
  const end = (take.audio.startFrame + take.audio.samples.length) / take.audio.sampleRate
  return Math.max(1, Math.ceil((end - take.origin - 1e-8) / (240 / take.settings.bpm)))
}
export function initialReviewBar(take: RecordedTake): number {
  const last = take.onsets.at(-1)?.time ?? take.origin
  return Math.min(recordedBarCount(take) - 1, Math.max(0, Math.floor((last - take.origin + 1e-8) / (240 / take.settings.bpm)) - 1))
}
export function recordedBar(take: RecordedTake, index: number) {
  const barSeconds = 240 / take.settings.bpm
  const start = take.origin + index * barSeconds
  const end = start + barSeconds
  const startFrame = Math.max(take.audio.startFrame, Math.round(start * take.audio.sampleRate))
  const endFrame = Math.min(take.audio.startFrame + take.audio.samples.length, Math.round(end * take.audio.sampleRate))
  const samples = take.audio.samples.subarray(startFrame - take.audio.startFrame, Math.max(startFrame, endFrame) - take.audio.startFrame)
  const min = Array<number>(WAVEFORM_COLUMNS).fill(0)
  const max = Array<number>(WAVEFORM_COLUMNS).fill(0)
  const populated = new Uint8Array(WAVEFORM_COLUMNS)
  for (let i = 0; i < samples.length; i++) {
    const column = Math.min(WAVEFORM_COLUMNS - 1, Math.floor(((startFrame + i) / take.audio.sampleRate - start) / barSeconds * WAVEFORM_COLUMNS))
    if (column < 0) continue
    if (!populated[column]) { min[column] = samples[i]; max[column] = samples[i]; populated[column] = 1 }
    min[column] = Math.min(min[column], samples[i])
    max[column] = Math.max(max[column], samples[i])
  }
  const onsets = take.onsets.filter(hit => hit.time >= start - 1e-8 && hit.time < end - 1e-8)
  const complete = startFrame <= Math.round(start * take.audio.sampleRate) && endFrame >= Math.round(end * take.audio.sampleRate)
  const waveform: BarWaveformSnapshot = {
    min, max, available: true, progress: 1,
    review: complete ? 'complete' : 'partial',
    hits: onsets.map(hit => ({ ...hit, position: Math.max(0, (hit.time - start) / barSeconds) })),
  }
  return { index, start, end, audio: { samples, startFrame, sampleRate: take.audio.sampleRate }, waveform, complete, availableFraction: samples.length / (barSeconds * take.audio.sampleRate), endReason: take.endReason }
}
