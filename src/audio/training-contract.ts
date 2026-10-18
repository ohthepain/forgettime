import { z } from 'zod'

export const TRAINING_SCHEMA_VERSION = 1
export const MAX_TRAINING_EXAMPLES = 100
export const MAX_TRAINING_AUDIO_BYTES = 256 * 1024 * 1024
export const MAX_TRAINING_MANIFEST_BYTES = 2 * 1024 * 1024
const frame = z.number().int().safe().nonnegative()
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const name = z.string().min(1).max(256)
const range = z.strictObject({ startFrame: frame, endFrame: frame }).refine(r => r.endFrame > r.startFrame, 'Empty frame interval')
const sourceSchema = z.strictObject({
  checksum: hash, sampleRate: z.number().int().min(8000).max(192000), frames: frame.positive().max(MAX_TRAINING_AUDIO_BYTES / 4),
  channels: z.literal(1), encoding: z.literal('float32-le'),
  // A cropped file is a new exact source, with optional relationship to its ancestor.
  provenance: z.strictObject({ kind: z.enum(['capture', 'import', 'unknown']), name: name.optional(),
    ancestorChecksum: hash.optional(), ancestorStartFrame: frame.optional(),
    beginningAvailable: z.boolean(), endAvailable: z.boolean() }),
})
const exampleSchema = z.strictObject({
  id: z.string().min(1).max(160), sourceChecksum: hash,
  // A bar can extend beyond retained source coverage (a partial bar).
  bar: z.strictObject({ startFrame: z.number().int().safe(), endFrame: z.number().int().safe() })
    .refine(r => r.endFrame > r.startFrame, 'Empty bar interval'),
  reference: z.strictObject({ bpm: z.number().min(30).max(300), beatOneFrame: z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER), meter: z.tuple([z.literal(4), z.literal(4)]) }),
  desiredFrames: z.array(frame).max(20000), uncertain: z.array(range).max(2000),
  reviewed: z.boolean(),
})
const groupSchema = z.strictObject({ id: name, sourceChecksums: z.array(hash).min(1).max(10000), assignment: z.enum(['training', 'withheld', 'unassigned']) })
const manifestSchema = z.strictObject({ format: z.literal('forgettime-training'), schemaVersion: z.literal(1),
  sources: z.array(sourceSchema).max(10000), examples: z.array(exampleSchema).max(MAX_TRAINING_EXAMPLES), groups: z.array(groupSchema).max(10000),
})
export type TrainingSource = z.infer<typeof sourceSchema>
export type TrainingExample = z.infer<typeof exampleSchema>
export type TrainingManifest = z.infer<typeof manifestSchema>
export type FrameRange = z.infer<typeof range>

/** Source coordinates always start at decoded PCM frame zero, never playback time. */
export function trainingExampleId(checksum: string, bar: FrameRange): string {
  hash.parse(checksum)
  if (!Number.isSafeInteger(bar.startFrame) || !Number.isSafeInteger(bar.endFrame) || bar.endFrame <= bar.startFrame) throw new Error('Invalid bar frames')
  return `${checksum}:${bar.startFrame}:${bar.endFrame}`
}
function unique<T>(values: T[], message: string) { if (new Set(values).size !== values.length) throw new Error(message) }

export function validateTrainingManifest(input: unknown): TrainingManifest {
  const m = manifestSchema.parse(input)
  unique(m.sources.map(s => s.checksum), 'Duplicate source')
  unique(m.examples.map(e => e.id), 'Duplicate example')
  unique(m.groups.map(g => g.id), 'Duplicate group')
  const sources = new Map(m.sources.map(s => [s.checksum, s]))
  const total = m.sources.reduce((n, s) => n + s.frames * 4, 0)
  if (total > MAX_TRAINING_AUDIO_BYTES) throw new Error('Training audio exceeds storage limit')
  const grouped: string[] = []
  const groupFor = new Map<string, string>()
  for (const g of m.groups) {
    unique(g.sourceChecksums, 'Duplicate source in group')
    for (const checksum of g.sourceChecksums) {
      if (!sources.has(checksum)) throw new Error('Unknown grouped source')
      grouped.push(checksum)
      groupFor.set(checksum, g.id)
    }
  }
  unique(grouped, 'Source belongs to multiple groups')
  if (grouped.length !== sources.size) throw new Error('Every source requires a recording group')
  for (const s of m.sources) {
    if ((s.provenance.ancestorChecksum === undefined) !== (s.provenance.ancestorStartFrame === undefined)) throw new Error('Incomplete ancestor provenance')
    const ancestor = s.provenance.ancestorChecksum && sources.get(s.provenance.ancestorChecksum)
    if (ancestor && (ancestor.checksum === s.checksum || s.provenance.ancestorStartFrame! + s.frames > ancestor.frames || groupFor.get(ancestor.checksum) !== groupFor.get(s.checksum))) throw new Error('Invalid ancestor extent or recording group')
  }
  for (const e of m.examples) {
    const source = sources.get(e.sourceChecksum)
    if (!source) throw new Error('Unknown example source')
    const durationFrames = source.sampleRate * 240 / e.reference.bpm
    const barIndex = Math.round((e.bar.startFrame - e.reference.beatOneFrame) / durationFrames)
    const expected = trainingBarFrames(source.sampleRate, e.reference.bpm, e.reference.beatOneFrame, barIndex)
    if (expected.startFrame !== e.bar.startFrame || expected.endFrame !== e.bar.endFrame) throw new Error('Bar does not match musical reference')
    if (e.id !== trainingExampleId(e.sourceChecksum, e.bar)) throw new Error('Example identity does not match source/bar')
    if (e.bar.endFrame <= 0 || e.bar.startFrame >= source.frames) throw new Error('Bar has no source coverage')
    const inside = (n: number) => n >= Math.max(0, e.bar.startFrame) && n < Math.min(source.frames, e.bar.endFrame)
    unique(e.desiredFrames, 'Duplicate desired attack')
    if (e.desiredFrames.some((n, i, a) => !inside(n) || (i > 0 && n <= a[i - 1]))) throw new Error('Desired attacks must be sorted inside available bar coverage')
    for (let i = 0; i < e.uncertain.length; i++) {
      const r = e.uncertain[i]
      if (!inside(r.startFrame) || r.endFrame > Math.min(source.frames, e.bar.endFrame) || (i > 0 && r.startFrame < e.uncertain[i - 1].endFrame)) throw new Error('Uncertainty must be ordered and nonoverlapping within coverage')
    }
  }
  return m
}

/** Round both absolute musical boundaries, never accumulate rounded bar lengths. */
export function trainingBarFrames(sampleRate: number, bpm: number, beatOneFrame: number, barIndex: number): FrameRange {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000 || !Number.isFinite(bpm) || bpm < 30 || bpm > 300 || !Number.isFinite(beatOneFrame) || !Number.isSafeInteger(barIndex)) throw new Error('Invalid musical reference')
  const duration = sampleRate * 240 / bpm
  const startFrame = Math.round(beatOneFrame + barIndex * duration), endFrame = Math.round(beatOneFrame + (barIndex + 1) * duration)
  if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame) || endFrame <= startFrame) throw new Error('Invalid musical extent')
  return { startFrame, endFrame }
}

export function trainingCoverage(example: TrainingExample, source: TrainingSource) {
  if (source.checksum !== example.sourceChecksum) throw new Error('Source mismatch')
  return { startFrame: Math.max(0, example.bar.startFrame), endFrame: Math.min(source.frames, example.bar.endFrame),
    complete: example.bar.startFrame >= 0 && example.bar.endFrame <= source.frames,
    beforeFrames: Math.max(0, example.bar.startFrame), afterFrames: Math.max(0, source.frames - example.bar.endFrame),
    beginningAvailable: source.provenance.beginningAvailable, endAvailable: source.provenance.endAvailable }
}
/** Editing changes current labels only and always requires renewed review. */
export function reviseTrainingAnnotations(example: TrainingExample, desiredFrames: number[], uncertain: FrameRange[]): TrainingExample {
  return exampleSchema.parse({ ...example, desiredFrames: [...desiredFrames], uncertain: uncertain.map(r => ({ ...r })), reviewed: false })
}
export function trainingEligible(example: TrainingExample, source: TrainingSource) {
  const coverage = trainingCoverage(example, source)
  const excluded = example.uncertain.reduce((n, r) => n + r.endFrame - r.startFrame, 0)
  return example.reviewed && coverage.complete && excluded < example.bar.endFrame - example.bar.startFrame
}

async function digest(bytes: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('')
}
/** Canonical hashing includes the rate and full mono frame count, not a WAV header. */
export function canonicalTrainingPcm(channels: readonly Float32Array[], sampleRate: number): { samples: Float32Array; bytes: ArrayBuffer } {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000 || channels.length < 1 || channels.length > 8 || channels.some(c => !(c instanceof Float32Array))) throw new Error('Invalid PCM format')
  const frames = channels[0].length
  if (!frames || frames * 4 > MAX_TRAINING_AUDIO_BYTES || channels.some(c => c.length !== frames)) throw new Error('Invalid PCM length')
  const samples = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let value = channels[0][i]
    if (!Number.isFinite(value)) throw new Error('Nonfinite PCM')
    if (channels.length > 1) {
      for (let c = 1; c < channels.length; c++) { if (!Number.isFinite(channels[c][i])) throw new Error('Nonfinite PCM'); value += channels[c][i] }
      value /= channels.length
    }
    samples[i] = value
    if (!Number.isFinite(samples[i])) throw new Error('PCM overflow')
  }
  const bytes = new ArrayBuffer(24 + frames * 4), view = new DataView(bytes)
  // ASCII FTPCM001, uint32 rate, uint32 mono channels, uint64 frames, Float32 LE.
  new Uint8Array(bytes).set(new TextEncoder().encode('FTPCM001'))
  view.setUint32(8, sampleRate, true); view.setUint32(12, 1, true); view.setBigUint64(16, BigInt(frames), true)
  for (let i = 0; i < frames; i++) view.setFloat32(24 + i * 4, samples[i], true)
  return { samples, bytes }
}
export async function createTrainingSource(channels: readonly Float32Array[], sampleRate: number, provenance: TrainingSource['provenance']) {
  const { samples, bytes } = canonicalTrainingPcm(channels, sampleRate)
  const source = sourceSchema.parse({ checksum: await digest(bytes), sampleRate, frames: samples.length, channels: 1, encoding: 'float32-le', provenance })
  if ((provenance.ancestorChecksum === undefined) !== (provenance.ancestorStartFrame === undefined)) throw new Error('Incomplete ancestor provenance')
  return { source, samples }
}
export async function verifyTrainingSource(source: TrainingSource, samples: Float32Array): Promise<void> {
  sourceSchema.parse(source)
  if (samples.length !== source.frames || await digest(canonicalTrainingPcm([samples], source.sampleRate).bytes) !== source.checksum) throw new Error('Training PCM checksum mismatch')
}
function stable(input: unknown): string {
  if (Array.isArray(input)) return '[' + input.map(stable).join(',') + ']'
  if (input !== null && typeof input === 'object') return '{' + Object.entries(input).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => JSON.stringify(k) + ':' + stable(v)).join(',') + '}'
  return JSON.stringify(input)
}
function compareText(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0 }
function canonicalManifest(input: unknown): TrainingManifest {
  const m = validateTrainingManifest(input)
  m.sources.sort((a,b) => compareText(a.checksum, b.checksum))
  m.examples.sort((a,b) => compareText(a.id, b.id))
  m.groups.sort((a,b) => compareText(a.id, b.id))
  for (const g of m.groups) g.sourceChecksums.sort()
  return m
}
export function encodeTrainingManifest(input: TrainingManifest): string {
  const text = stable(canonicalManifest(input))
  if (new TextEncoder().encode(text).length > MAX_TRAINING_MANIFEST_BYTES) throw new Error('Training manifest too large')
  return text
}
export function parseTrainingManifest(text: string): TrainingManifest {
  if (new TextEncoder().encode(text).length > MAX_TRAINING_MANIFEST_BYTES) throw new Error('Training manifest too large')
  return validateTrainingManifest(JSON.parse(text))
}
/** Current content only: this digest stores no old annotation revision. */
export async function trainingFingerprint(input: TrainingManifest): Promise<string> {
  return digest(new TextEncoder().encode(encodeTrainingManifest(input)).buffer)
}
