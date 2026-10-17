import { z } from 'zod'
import { barSidecarSchema, MAX_SIDECAR_BYTES } from './bar-files'
import { normalizeDetectorSettings, type DetectorSettings } from './detector-contract'
import { recordedBarCount, type RecordedTake } from './recorded-take'
import { MAX_PCM_BYTES } from './wav'

export interface PerformanceReview {
  frequencyBalance: number
  barIndex: number
  detectionSensitivity: number | null
  detector: DetectorSettings
}
export interface LatestPerformance { take: RecordedTake; review: PerformanceReview }
export interface LatestPerformanceRepository {
  read(): Promise<LatestPerformance | null>
  save(performance: LatestPerformance): Promise<void>
}
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const metadataSchema = z.strictObject({
  source: z.enum(['web', 'native', 'saved', 'imported']),
  sampleRate: integer.min(8000).max(192000), startFrame: integer,
  origin: z.number().finite().min(-120).max(86400), continuity: integer,
  barCount: integer.positive().max(150).optional(),
  settings: barSidecarSchema.shape.settings,
  provenance: barSidecarSchema.shape.provenance.optional(),
  analysis: barSidecarSchema.shape.analysis,
  original: barSidecarSchema.shape.original,
  endReason: barSidecarSchema.shape.endReason,
})
const reviewSchema = z.strictObject({
  frequencyBalance: z.number().min(0).max(100).default(100),
  barIndex: integer, detectionSensitivity: z.number().int().min(0).max(100).nullable(),
  detector: barSidecarSchema.shape.settings.shape.detector.unwrap(),
})
type StoredTake = { version: 1; metadata: string; samples: Float32Array }
function encode(take: RecordedTake): StoredTake {
  const { audio, onsets, results, diagnostics, analysis, ...rest } = take
  const metadata = JSON.stringify({ ...rest, sampleRate: audio.sampleRate, startFrame: audio.startFrame,
    analysis: analysis ?? null, original: { onsets, results, diagnostics: diagnostics ?? null } })
  const stored = { version: 1 as const, metadata, samples: audio.samples }
  decode(stored)
  return stored
}
function decode(value: unknown): RecordedTake {
  const stored = value as StoredTake
  if (!stored || stored.version !== 1 || typeof stored.metadata !== 'string'
    || stored.metadata.length > MAX_SIDECAR_BYTES || new TextEncoder().encode(stored.metadata).length > MAX_SIDECAR_BYTES
    || !(stored.samples instanceof Float32Array) || !stored.samples.length || stored.samples.byteLength > MAX_PCM_BYTES) throw new Error('Invalid latest performance')
  const { sampleRate, startFrame, original, analysis, ...metadata } = metadataSchema.parse(JSON.parse(stored.metadata))
  if (stored.samples.length > sampleRate * 120 || !stored.samples.every(Number.isFinite)
    || original.results.some(hit => hit.uncertain !== (hit.errorMs === null))) throw new Error('Invalid latest performance audio or analysis')
  return { ...metadata, audio: { sampleRate, startFrame, samples: stored.samples }, ...original,
    analysis: analysis ?? undefined, diagnostics: original.diagnostics ?? undefined }
}
function reviewFor(take: RecordedTake, value: unknown): PerformanceReview {
  const review = reviewSchema.parse(value)
  if (review.barIndex >= recordedBarCount(take)) throw new Error('Invalid latest review bar')
  return { ...review, detector: normalizeDetectorSettings(review.detector) }
}
/** A single best-effort development recovery slot, separate from explicitly saved bars.
 * IndexedDB also lives in the native WebView's persistent, on-device origin store.
 * Audio and review commit together; tuning an unchanged take writes only review state. */
export function createLatestPerformanceRepository(factory: IDBFactory = indexedDB): LatestPerformanceRepository {
  let committedTake: RecordedTake | null = null
  let queue: Promise<void> = Promise.resolve()
  const connect = () => new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('forgettime-latest-performance', 1)
    let blocked = false
    request.onupgradeneeded = () => request.result.createObjectStore('latest')
    request.onerror = () => reject(request.error)
    request.onblocked = () => { blocked = true; reject(new Error('Latest performance store blocked')) }
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result) }
  })
  return {
    async read() {
      const db = await connect()
      const record = await new Promise<{ take: unknown; review: unknown }>((resolve, reject) => {
        const tx = db.transaction('latest', 'readonly'), store = tx.objectStore('latest')
        const take = store.get('take'), review = store.get('review')
        tx.oncomplete = () => { db.close(); resolve({ take: take.result, review: review.result }) }
        tx.onabort = () => { db.close(); reject(tx.error) }
      })
      if (record.take === undefined) return null
      const take = decode(record.take), review = reviewFor(take, record.review)
      committedTake = take
      return { take, review }
    },
    save(performance) {
      const operation = queue.catch(() => {}).then(async () => {
        const review = reviewFor(performance.take, performance.review)
        const changed = performance.take !== committedTake
        const take = changed ? encode(performance.take) : null
        const db = await connect()
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('latest', 'readwrite'), store = tx.objectStore('latest')
          if (take) store.put(take, 'take')
          store.put(review, 'review')
          tx.oncomplete = () => { db.close(); resolve() }
          tx.onabort = () => { db.close(); reject(tx.error) }
        })
        committedTake = performance.take
      })
      queue = operation
      return operation
    },
  }
}
