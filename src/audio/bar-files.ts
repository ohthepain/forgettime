import { z } from 'zod'
import { recordedBar, recordedBarCount, type RecordedTake } from './recorded-take'
import { decodeWav, encodeFloatWav, MAX_AUDIO_FILE_BYTES } from './wav'
import { MAX_DIAGNOSTIC_CANDIDATES } from './detector-contract'
export const MAX_SIDECAR_BYTES = 2 * 1024 * 1024
const finite = z.number().finite()
const time = finite.min(-120).max(86400)
const positive = finite.nonnegative().max(Number.MAX_VALUE)
const unit = finite.min(0).max(1)
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const detector = z.strictObject({ version: z.literal(1), minimumRms: finite.min(.001).max(.1), contrastRatio: finite.min(1.1).max(4), minSeparationMs: finite.min(8).max(100), recoverySeconds: finite.min(.25).max(12) })
const onset = z.strictObject({ time, strength: unit, confidence: unit })
const candidate = z.strictObject({ version: z.literal(1), id: integer, time, strength: unit, confidence: unit, accepted: z.boolean(), reasons: z.array(z.enum(['warming-up', 'level', 'rise', 'contrast', 'rearming', 'separation'])).max(6), settings: detector,
  measurements: z.strictObject({ rms: positive, minimumLevel: positive, levelReference: positive, rise: finite, minimumRise: positive, ratio: positive, minimumRatio: positive, contrast: finite, minimumContrast: positive, backgroundRms: positive, baselineRms: positive, armed: z.boolean(), rearmRatio: positive, elapsedMs: positive.nullable(), minimumSeparationMs: positive }),
  acquisition: z.enum(['started', 'below-start-level', 'low-confidence', 'not-required']).optional(), acquisitionGate: z.strictObject({ minimumStrength: unit, minimumConfidence: unit }).optional() })
const result = z.strictObject({ id: integer, time, errorMs: finite.min(-120000).max(120000).nullable(), confidence: unit, subdivision: z.enum(['quarter', 'eighth', 'sixteenth', 'triplet', 'sextuplet']), uncertain: z.boolean(), reason: z.string().max(1024).optional(), displayedAt: time, guidance: z.strictObject({ intendedTime: time, errorMs: finite.min(-120000).max(120000) }).optional() })
export const barSidecarSchema = z.strictObject({ format: z.literal('forgettime-bar'), schemaVersion: z.literal(1),
  audio: z.strictObject({ encoding: z.literal('float32'), byteLength: integer.max(MAX_AUDIO_FILE_BYTES), sha256: z.string().regex(/^[a-f0-9]{64}$/), sampleRate: integer.min(8000).max(192000), channels: z.literal(1), frames: integer.positive() }),
  musical: z.strictObject({ origin: time, duration: finite.positive().max(120), bars: z.literal(1), complete: z.boolean() }),
  settings: z.strictObject({ bpm: finite.min(30).max(300), mode: z.enum(['auto', 'straight', 'swing']), startSensitivity: finite.min(0).max(100), detector: detector.optional() }),
  meter: z.tuple([z.literal(4), z.literal(4)]),
  provenance: z.strictObject({ kind: z.enum(['capture', 'import', 'unknown']), platform: z.enum(['web', 'native']).optional(), name: z.string().max(255).optional() }),
  analysis: z.strictObject({ implementation: z.string().min(1).max(100), version: z.string().min(1).max(100) }).nullable(),
  original: z.strictObject({ onsets: z.array(onset).max(20000), results: z.array(result).max(20000), diagnostics: z.strictObject({ candidates: z.array(candidate).max(MAX_DIAGNOSTIC_CANDIDATES), dropped: integer }).nullable() }),
  endReason: z.enum(['silence', 'stopped', 'interrupted', 'limit']) })
export type BarSidecar = z.infer<typeof barSidecarSchema>
export interface BarFiles { wav: ArrayBuffer; sidecar: string }
export async function audioDigest(bytes: ArrayBuffer) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
export function parseBarSidecar(text: string): BarSidecar {
  if (text.length > MAX_SIDECAR_BYTES || new TextEncoder().encode(text).length > MAX_SIDECAR_BYTES) throw new Error('Bar metadata exceeds supported limits.')
  try {
    const metadata = barSidecarSchema.parse(JSON.parse(text))
    const { results, diagnostics } = metadata.original
    if (results.some(hit => hit.uncertain !== (hit.errorMs === null)) || new Set(results.map(hit => hit.id)).size !== results.length) throw new Error('Contradictory original scores.')
    if (diagnostics && (new Set(diagnostics.candidates.map(hit => hit.id)).size !== diagnostics.candidates.length || diagnostics.candidates.some(hit => hit.accepted !== (hit.reasons.length === 0) || new Set(hit.reasons).size !== hit.reasons.length))) throw new Error('Contradictory detector diagnostics.')
    return metadata
  } catch { throw new Error('Unsupported or invalid .forget metadata.') }
}
export async function createBarFiles(take: RecordedTake, index: number): Promise<BarFiles> {
  if (!Number.isInteger(index) || index < 0 || index >= recordedBarCount(take)) throw new Error('Select a recorded bar first.')
  const bar = recordedBar(take, index), offset = bar.audio.startFrame / bar.audio.sampleRate
  const selected = (hit: { time: number }) => hit.time >= bar.start - 1e-8 && hit.time < bar.end - 1e-8
  const wav = encodeFloatWav(bar.audio.samples, bar.audio.sampleRate)
  const metadata: BarSidecar = { format: 'forgettime-bar', schemaVersion: 1,
    audio: { encoding: 'float32', byteLength: wav.byteLength, sha256: await audioDigest(wav), sampleRate: bar.audio.sampleRate, channels: 1, frames: bar.audio.samples.length },
    musical: { origin: bar.start - offset, duration: 240 / take.settings.bpm, bars: 1, complete: bar.complete }, settings: take.settings, meter: [4, 4],
    provenance: take.provenance ?? { kind: take.source === 'web' || take.source === 'native' ? 'capture' : 'unknown', ...(take.source === 'web' || take.source === 'native' ? { platform: take.source } : {}) }, analysis: take.analysis ?? null,
    original: { onsets: take.onsets.filter(selected).map(hit => ({ ...hit, time: hit.time - offset })),
      results: take.results.filter(selected).map(hit => ({ ...hit, time: hit.time - offset, displayedAt: hit.displayedAt - offset, ...(hit.guidance ? { guidance: { ...hit.guidance, intendedTime: hit.guidance.intendedTime - offset } } : {}) })),
      diagnostics: take.diagnostics ? { dropped: take.diagnostics.dropped, candidates: take.diagnostics.candidates.filter(selected).map(hit => ({ ...hit, time: hit.time - offset })) } : null }, endReason: take.endReason }
  const sidecar = JSON.stringify(metadata)
  parseBarSidecar(sidecar)
  return { wav, sidecar }
}
export async function restoreBarFiles(files: BarFiles, source: 'saved' | 'imported' = 'saved'): Promise<RecordedTake> {
  const metadata = parseBarSidecar(files.sidecar)
  if (files.wav.byteLength > MAX_AUDIO_FILE_BYTES || files.wav.byteLength !== metadata.audio.byteLength || await audioDigest(files.wav) !== metadata.audio.sha256) throw new Error('The WAV does not match this .forget file.')
  const audio = decodeWav(files.wav)
  if (audio.encoding !== metadata.audio.encoding || audio.channels !== metadata.audio.channels || audio.sampleRate !== metadata.audio.sampleRate || audio.samples.length !== metadata.audio.frames) throw new Error('WAV format does not match its metadata.')
  const { origin, duration, complete } = metadata.musical
  const startFrame = Math.round(origin * audio.sampleRate), endFrame = Math.round((origin + duration) * audio.sampleRate)
  if (Math.abs(duration - 240 / metadata.settings.bpm) > 1e-9 || startFrame > 0 || endFrame < audio.samples.length || endFrame <= 0 || complete !== (startFrame === 0 && endFrame === audio.samples.length)) throw new Error('Invalid musical coverage in bar metadata.')
  const events = [...metadata.original.onsets, ...metadata.original.results, ...(metadata.original.diagnostics?.candidates ?? [])]
  if (events.some(hit => hit.time < origin - 1e-8 || hit.time >= origin + duration - 1e-8)) throw new Error('Original event lies outside the selected bar.')
  return { source, audio: { samples: audio.samples, sampleRate: audio.sampleRate, startFrame: 0 }, origin, barCount: 1, continuity: 0, settings: metadata.settings, provenance: metadata.provenance, analysis: metadata.analysis ?? undefined, onsets: metadata.original.onsets, results: metadata.original.results, diagnostics: metadata.original.diagnostics ?? undefined, endReason: metadata.endReason }
}
