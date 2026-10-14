import { validateDecodedAudio, type ImportFile } from './audio-import'
import { ForgettimeAudio as native, type NativeFileHandle } from 'forgettime-audio'
import { restoreBarFiles, MAX_SIDECAR_BYTES } from './bar-files'
import { MAX_AUDIO_FILE_BYTES, MAX_PCM_BYTES } from './wav'
import { summarySchema, MAX_SAVED_BARS, MAX_LIBRARY_BYTES, type BarFileOptions } from './saved-bars'
const CHUNK = 65536
function size(value: number, max: number) { if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error('Native file size exceeds supported limits.'); return value }
function handle(value: string) { if (typeof value !== 'string' || !value || value.length > 128) throw new Error('Invalid native file handle.'); return value }
async function upload(transferId: string, part: 'wav' | 'sidecar' | 'audio', bytes: Uint8Array) {
  handle(transferId)
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    let text = ''; for (const byte of bytes.subarray(offset, offset + CHUNK)) text += String.fromCharCode(byte)
    await native.appendFileChunk({ transferId, part, offset, data: btoa(text) })
  }
}
async function read(file: NativeFileHandle, max: number): Promise<ArrayBuffer> {
  handle(file.handle); const bytes = new Uint8Array(size(file.size, max))
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    const length = Math.min(CHUNK, bytes.length - offset)
    const { data } = await native.readFileChunk({ handle: file.handle, offset, length })
    if (typeof data !== 'string' || data.length > Math.ceil(CHUNK / 3) * 4) throw new Error('Native file chunk is invalid.')
    const decoded = atob(data)
    if (decoded.length !== length) throw new Error('Native file changed or was truncated.')
    for (let i = 0; i < length; i++) bytes[offset + i] = decoded.charCodeAt(i)
  }
  return bytes.buffer
}
export function createNativeBarFiles(): BarFileOptions {
  return {
    exportPair: async id => (await native.exportSavedBar({ id })).status,
    importer: {
      async pick() {
        const { files } = await native.pickAudioFiles()
        try {
          if (!Array.isArray(files) || files.length > 2) throw new Error('Choose one WAV or M4A and an optional .forget file.')
          const selected: ImportFile[] = []
          for (const file of files) {
            if (typeof file.name !== 'string' || !file.name.length || file.name.length > 255 || !/\.(wav|m4a|forget)$/i.test(file.name)) throw new Error('Choose a supported WAV, M4A or .forget file.')
            const bytes = await read(file, /\.forget$/i.test(file.name) ? MAX_SIDECAR_BYTES : MAX_AUDIO_FILE_BYTES)
            selected.push({ name: file.name, size: bytes.byteLength, read: async () => bytes })
          }
          return selected
        } finally { if (Array.isArray(files)) await native.releaseFiles({ handles: files.flatMap(file => file && typeof file.handle === 'string' ? [file.handle] : []) }) }
      },
      async decode(file, bytes) {
        size(bytes.byteLength, MAX_AUDIO_FILE_BYTES)
        if (!/\.m4a$/i.test(file.name)) throw new Error('Native decoder supports M4A audio; WAV uses the shared decoder.')
        const { transferId } = await native.beginAudioDecode({ name: file.name, byteLength: bytes.byteLength })
        let result: NativeFileHandle | undefined
        try {
          await upload(transferId, 'audio', new Uint8Array(bytes))
          const pcm = await native.finishAudioDecode({ transferId }); result = pcm
          if (!Number.isSafeInteger(pcm.frames) || pcm.frames * 4 !== pcm.size) throw new Error('Native decoded frame count is invalid.')
          const buffer = await read(pcm, MAX_PCM_BYTES), view = new DataView(buffer), samples = new Float32Array(pcm.frames)
          for (let i = 0; i < samples.length; i++) samples[i] = view.getFloat32(i * 4, true)
          return validateDecodedAudio({ samples, sampleRate: pcm.sampleRate, channels: pcm.channels })
        } finally {
          try { if (result) await native.releaseFiles({ handles: [result.handle] }) }
          finally { await native.abortFileTransfer({ transferId }) }
        }
      },
    },
    savedBars: {
    async list() {
      const bars = summarySchema.array().max(MAX_SAVED_BARS).parse((await native.listSavedBars()).bars)
      if (new Set(bars.map(bar => bar.id)).size !== bars.length || bars.reduce((sum, bar) => sum + bar.bytes, 0) > MAX_LIBRARY_BYTES) throw new Error('Native saved library index is invalid.')
      return bars
    },
    async save(record) {
      const { wav, sidecar, ...summary } = record
      summarySchema.parse(summary)
      const text = new TextEncoder().encode(sidecar)
      size(wav.byteLength, MAX_AUDIO_FILE_BYTES); size(text.length, MAX_SIDECAR_BYTES)
      if (summary.bytes !== wav.byteLength + text.length) throw new Error('Saved pair size is invalid.')
      await restoreBarFiles({ wav, sidecar })
      const { transferId } = await native.beginBarSave({ summary, wavBytes: wav.byteLength, sidecarBytes: text.length })
      try { await upload(transferId, 'wav', new Uint8Array(wav)); await upload(transferId, 'sidecar', text); await native.commitBarSave({ transferId }) }
      finally { await native.abortFileTransfer({ transferId }) }
    },
    async read(id) {
      const result = await native.readSavedBar({ id })
      try {
        const summary = summarySchema.parse(result.summary)
        if (summary.id !== id) throw new Error('Native saved bar ID mismatch.')
        const wav = await read(result.wav, MAX_AUDIO_FILE_BYTES), sidecar = new TextDecoder('utf-8', { fatal: true }).decode(await read(result.sidecar, MAX_SIDECAR_BYTES))
        if (summary.bytes !== wav.byteLength + new TextEncoder().encode(sidecar).length) throw new Error('Native saved pair is incomplete.')
        await restoreBarFiles({ wav, sidecar })
        return { ...summary, wav, sidecar }
      } finally { await native.releaseFiles({ handles: [result.wav.handle, result.sidecar.handle] }) }
    },
  } }
}
