import { beforeEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createNativeBarFiles } from './native-files'
import { restoreBarFiles } from './bar-files'
import { prepareAudioImport } from './audio-import'
const edge = vi.hoisted(() => ({ beginBarSave: vi.fn(), appendFileChunk: vi.fn(), commitBarSave: vi.fn(), abortFileTransfer: vi.fn(), readSavedBar: vi.fn(), listSavedBars: vi.fn(), readFileChunk: vi.fn(), releaseFiles: vi.fn(), pickAudioFiles: vi.fn(), exportSavedBar: vi.fn(), beginAudioDecode: vi.fn(), finishAudioDecode: vi.fn() }))
vi.mock('forgettime-audio', () => ({ ForgettimeAudio: edge }))
const fixture = () => ({ wav: Uint8Array.from(readFileSync('tests/fixtures/bar-files/float32-partial.wav')).buffer, sidecar: readFileSync('tests/fixtures/bar-files/float32-partial.forget', 'utf8') })
beforeEach(() => { for (const fn of Object.values(edge)) fn.mockReset(); edge.releaseFiles.mockResolvedValue(undefined); edge.abortFileTransfer.mockResolvedValue(undefined) })
it('saves and reopens the portable pair exactly through bounded native chunks', async () => {
  const files = fixture(), summary = { id: 'saved-one', name: 'Bar 1', createdAt: 0, bpm: 137, complete: false, bytes: files.wav.byteLength + new TextEncoder().encode(files.sidecar).length }
  const stored = new Map<string, number[]>()
  edge.beginBarSave.mockResolvedValue({ transferId: 'upload' })
  edge.appendFileChunk.mockImplementation(async ({ part, offset, data }) => { const bytes = [...Buffer.from(data, 'base64')]; expect(bytes.length).toBeLessThanOrEqual(65536); const all = stored.get(part) ?? []; expect(offset).toBe(all.length); all.push(...bytes); stored.set(part, all) })
  edge.commitBarSave.mockResolvedValue(undefined)
  edge.readSavedBar.mockImplementation(async () => ({ summary, wav: { handle: 'wav', size: stored.get('wav')!.length }, sidecar: { handle: 'sidecar', size: stored.get('sidecar')!.length } }))
  edge.readFileChunk.mockImplementation(async ({ handle, offset, length }) => ({ data: Buffer.from(stored.get(handle)!.slice(offset, offset + length)).toString('base64') }))
  const options = createNativeBarFiles()
  await options.savedBars!.save({ ...summary, ...files })
  const restored = await options.savedBars!.read(summary.id)
  expect(restored.wav).toEqual(files.wav); expect(restored.sidecar).toBe(files.sidecar)
  expect((await restoreBarFiles(restored)).origin).toBe((await restoreBarFiles(files)).origin)
  expect(edge.commitBarSave).toHaveBeenCalledOnce()
  expect(edge.releaseFiles).toHaveBeenCalledWith({ handles: ['wav', 'sidecar'] })
})
it('releases all picked handles before pair restoration and keeps fallback bytes after a bad sidecar', async () => {
  const files = fixture(), wav = Buffer.from(files.wav), sidecar = Buffer.from('{bad json')
  edge.pickAudioFiles.mockResolvedValue({ files: [{ handle: 'audio', size: wav.length, name: 'test.wav' }, { handle: 'context', size: sidecar.length, name: 'test.forget' }] })
  edge.readFileChunk.mockImplementation(async ({ handle, offset, length }) => ({ data: (handle === 'audio' ? wav : sidecar).subarray(offset, offset + length).toString('base64') }))
  const importer = createNativeBarFiles().importer!
  const picked = await importer.pick!()
  expect(edge.releaseFiles).toHaveBeenCalledWith({ handles: ['audio', 'context'] })
  const prepared = await prepareAudioImport(picked, importer)
  expect(prepared.kind).toBe('fallback')
  expect(await picked[0].read()).toEqual(files.wav)
})
it('cleans staged uploads and picked handles on write/read failures', async () => {
  const files = fixture(), options = createNativeBarFiles()
  edge.beginBarSave.mockResolvedValue({ transferId: 'failed-save' }); edge.appendFileChunk.mockRejectedValue(new Error('Disk full'))
  await expect(options.savedBars!.save({ ...files, id: 'one', name: 'one', bpm: 137, complete: false, createdAt: 0, bytes: files.wav.byteLength + Buffer.byteLength(files.sidecar) })).rejects.toThrow('Disk full')
  expect(edge.abortFileTransfer).toHaveBeenCalledWith({ transferId: 'failed-save' })
  edge.pickAudioFiles.mockResolvedValue({ files: [{ name: 'bad.wav', handle: 'bad', size: 44 }] }); edge.readFileChunk.mockResolvedValue({ data: 'AA==' })
  await expect(options.importer!.pick!()).rejects.toThrow('truncated')
  expect(edge.releaseFiles).toHaveBeenCalledWith({ handles: ['bad'] })
})
it('decodes native compressed bytes without changing their sample rate or channel average', async () => {
  edge.beginAudioDecode.mockResolvedValue({ transferId: 'decode' }); edge.appendFileChunk.mockResolvedValue(undefined)
  edge.finishAudioDecode.mockResolvedValue({ handle: 'pcm', size: 12, frames: 3, sampleRate: 44100, channels: 2 })
  const bytes = Buffer.alloc(12); [-0.25, 0, 0.75].forEach((sample, i) => bytes.writeFloatLE(sample, i * 4))
  edge.readFileChunk.mockResolvedValue({ data: bytes.toString('base64') })
  const audio = await createNativeBarFiles().importer!.decode({ name: 'drums.m4a', size: 4, read: async () => new ArrayBuffer(4) }, new ArrayBuffer(4))
  expect(audio).toEqual({ samples: new Float32Array([-0.25, 0, 0.75]), sampleRate: 44100, channels: 2 })
  expect(edge.releaseFiles).toHaveBeenCalledWith({ handles: ['pcm'] }); expect(edge.abortFileTransfer).toHaveBeenCalledWith({ transferId: 'decode' })
})
