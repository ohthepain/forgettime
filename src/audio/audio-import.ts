import { MAX_SIDECAR_BYTES, restoreBarFiles } from './bar-files'
import { decodeWav, MAX_AUDIO_FILE_BYTES, MAX_PCM_BYTES } from './wav'
import type { RecordedTake, TakeSettings } from './recorded-take'
/** Selected files only. Native pickers can retain scoped handles behind read(). */
export interface ImportFile { name: string; size: number; read(): Promise<ArrayBuffer> }
export interface DecodedImportAudio { samples: Float32Array; sampleRate: number; channels: number }
export interface AudioImportAdapter {
  pick?(): Promise<ImportFile[]>
  /** Ordinary compressed audio only. Shared WAV decoding never calls this edge. */
  decode(file: ImportFile, bytes: ArrayBuffer): Promise<DecodedImportAudio>
}
export type ImportPreparation = { kind: 'restored'; take: RecordedTake } | { kind: 'fallback'; file: ImportFile; bytes: ArrayBuffer; explanation: string } | { kind: 'setup'; file: ImportFile; audio: DecodedImportAudio; explanation: string }
export type ImportState = Exclude<ImportPreparation, { kind: 'restored' }> & { bpm: number }
export function browserImportFile(file: File): ImportFile { return { name: file.name, size: file.size, read: () => file.arrayBuffer() } }
export function validateDecodedAudio(audio: DecodedImportAudio): DecodedImportAudio {
  if (!(audio.samples instanceof Float32Array) || !audio.samples.length || audio.samples.byteLength > MAX_PCM_BYTES || !Number.isInteger(audio.sampleRate) || audio.sampleRate < 8000 || audio.sampleRate > 192000 || audio.samples.length > audio.sampleRate * 120 || !Number.isInteger(audio.channels) || audio.channels < 1 || audio.channels > 8 || audio.samples.some(sample => !Number.isFinite(sample))) throw new Error('Decoded audio exceeds supported limits or contains invalid samples.')
  return audio
}
export async function decodeImportAudio(file: ImportFile, bytes: ArrayBuffer, adapter: AudioImportAdapter) {
  return validateDecodedAudio(/\.wav$/i.test(file.name) ? decodeWav(bytes) : await adapter.decode(file, bytes))
}
async function readBounded(file: ImportFile, limit: number) {
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > limit) throw new Error(`${file.name}: file exceeds supported size limits.`)
  const bytes = await file.read()
  if (Object.prototype.toString.call(bytes) !== '[object ArrayBuffer]' || bytes.byteLength !== file.size || bytes.byteLength > limit) throw new Error('The selected file changed or exceeds supported limits.')
  return bytes
}
export async function prepareAudioImport(files: readonly ImportFile[], adapter: AudioImportAdapter): Promise<ImportPreparation> {
  const audio = files.filter(file => /\.(wav|m4a)$/i.test(file.name)), metadata = files.filter(file => /\.forget$/i.test(file.name))
  if (audio.length !== 1 || metadata.length > 1 || files.length !== audio.length + metadata.length) throw new Error('Choose one WAV or M4A file, optionally with one .forget file.')
  const file = audio[0]
  if (!file.name || file.name.length > 255) throw new Error('The selected filename is too long.')
  const bytes = await readBounded(file, MAX_AUDIO_FILE_BYTES)
  if (metadata.length) {
    try {
      const sidecar = new TextDecoder('utf-8', { fatal: true }).decode(await readBounded(metadata[0], MAX_SIDECAR_BYTES))
      return { kind: 'restored', take: await restoreBarFiles({ wav: bytes, sidecar }, 'imported') }
    } catch (cause) {
      return { kind: 'fallback', file, bytes, explanation: `${cause instanceof Error ? cause.message : 'Metadata could not be restored.'} You can use the audio alone and set its tempo and beat one.` }
    }
  }
  return { kind: 'setup', file, audio: await decodeImportAudio(file, bytes, adapter), explanation: 'No .forget file selected. Confirm the tempo and place beat one before review. Original detection results are unavailable.' }
}
export function importedMaterial(state: Extract<ImportState, { kind: 'setup' }>, settings: TakeSettings, beatOne: number): RecordedTake {
  const duration = state.audio.samples.length / state.audio.sampleRate
  if (!Number.isFinite(settings.bpm) || settings.bpm < 30 || settings.bpm > 300 || !Number.isFinite(beatOne) || beatOne < 0 || beatOne >= duration) throw new Error('Use 30–300 BPM and place beat one within the audio.')
  return { source: 'imported', provenance: { kind: 'import', name: state.file.name }, continuity: 0, audio: { samples: state.audio.samples, startFrame: 0, sampleRate: state.audio.sampleRate }, origin: beatOne, settings: { bpm: settings.bpm, mode: settings.mode, startSensitivity: settings.startSensitivity }, onsets: [], results: [], endReason: 'stopped' }
}
/** Browser decode can allocate before the post-decode cap; it is not a streaming decoder. */
export const browserAudioImport: AudioImportAdapter = {
  async decode(file, bytes) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mp4' }))
    const media = document.createElement('audio')
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Audio metadata could not be read.')), 15000)
        media.onloadedmetadata = () => { clearTimeout(timeout); Number.isFinite(media.duration) && media.duration > 0 && media.duration <= 120 ? resolve() : reject(new Error('Audio must be no longer than 120 seconds.')) }
        media.onerror = () => { clearTimeout(timeout); reject(new Error(`This browser cannot read ${file.name}. Choose a supported WAV or M4A file.`)) }
        media.preload = 'metadata'; media.src = url
      })
    } finally { media.removeAttribute('src'); media.load(); URL.revokeObjectURL(url) }
    const context = new AudioContext()
    try {
      const decoded = await context.decodeAudioData(bytes.slice(0))
      if (!decoded.length || decoded.length * 4 > MAX_PCM_BYTES || decoded.duration > 120 || decoded.numberOfChannels < 1 || decoded.numberOfChannels > 8) throw new Error('Decoded audio exceeds supported limits.')
      const samples = new Float32Array(decoded.length)
      const channels = Array.from({ length: decoded.numberOfChannels }, (_, channel) => decoded.getChannelData(channel))
      for (let frame = 0; frame < samples.length; frame++) {
        let sum = channels[0][frame] / channels.length
        for (let channel = 1; channel < channels.length; channel++) sum += channels[channel][frame] / channels.length
        samples[frame] = sum
      }
      return validateDecodedAudio({ samples, sampleRate: decoded.sampleRate, channels: decoded.numberOfChannels })
    } catch (cause) { throw new Error(`Audio decoding failed: ${cause instanceof Error ? cause.message : 'unsupported codec'}`) }
    finally { await context.close() }
  },
}
