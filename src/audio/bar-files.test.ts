import { expect, it } from 'vitest'
import { createBarFiles, restoreBarFiles, audioDigest } from './bar-files'
import { recordedBar, type RecordedTake } from './recorded-take'
import { DEFAULT_DETECTOR_SETTINGS } from './detector-contract'
function partial(): RecordedTake {
  return { source: 'web', origin: 10, continuity: 1, settings: { bpm: 120, mode: 'straight', startSensitivity: 50, detector: { ...DEFAULT_DETECTOR_SETTINGS } }, audio: { startFrame: 80000, sampleRate: 8000, samples: Float32Array.of(-0, 1.25, -1.5, 0.125) }, onsets: [{ time: 10, strength: .8, confidence: .9 }], results: [{ id: 4, time: 10, displayedAt: 13, errorMs: 4, confidence: .9, subdivision: 'quarter', uncertain: false, guidance: { intendedTime: 9.996, errorMs: 4 } }], endReason: 'interrupted' }
}
it('preserves finite Float32 values, missing original diagnostics and delayed analysis context in a partial clip', async () => {
  const files = await createBarFiles(partial(), 0), restored = await restoreBarFiles(files)
  expect(restored.audio.samples).toEqual(Float32Array.of(-0, 1.25, -1.5, .125))
  expect(restored.origin).toBe(0)
  expect(recordedBar(restored, 0).complete).toBe(false)
  expect(restored.diagnostics).toBeUndefined()
  expect(restored.analysis).toBeUndefined()
  expect(restored.results[0]).toMatchObject({ time: 0, displayedAt: 3, errorMs: 4, guidance: { errorMs: 4 } })
  expect(restored.results[0].guidance!.intendedTime).toBeCloseTo(-.004, 12)
  expect((await createBarFiles(restored, 0)).wav).toEqual(files.wav)
})
it('rejects wrong audio bytes, invalid settings, unknown versions and incomplete WAV chunks', async () => {
  const files = await createBarFiles(partial(), 0)
  const wrong = files.wav.slice(0); new Uint8Array(wrong)[44] ^= 1
  await expect(restoreBarFiles({ ...files, wav: wrong })).rejects.toThrow('does not match')
  for (const modify of [(meta: any) => { meta.schemaVersion = 2 }, (meta: any) => { meta.settings.detector.minimumRms = -1 }, (meta: any) => { meta.audio.frames = 1.5 }, (meta: any) => { meta.original.onsets[0].time = 5 }]) {
    const meta = JSON.parse(files.sidecar); modify(meta)
    await expect(restoreBarFiles({ ...files, sidecar: JSON.stringify(meta) })).rejects.toThrow()
  }
  const invalid = files.wav.slice(0); new DataView(invalid).setUint32(40, 17, true)
  const meta = JSON.parse(files.sidecar); meta.audio.sha256 = await audioDigest(invalid)
  await expect(restoreBarFiles({ wav: invalid, sidecar: JSON.stringify(meta) })).rejects.toThrow('Truncated WAV chunk')
})
it('rejects contradictory original scores and duplicate result identities', async () => {
  const files = await createBarFiles(partial(), 0)
  for (const modify of [(meta: any) => { meta.original.results[0].uncertain = true }, (meta: any) => { meta.original.results.push(meta.original.results[0]) }]) {
    const meta = JSON.parse(files.sidecar); modify(meta)
    await expect(restoreBarFiles({ ...files, sidecar: JSON.stringify(meta) })).rejects.toThrow()
  }
})
it('reads the portable reference pair with exact signed-zero samples and original delayed results', async () => {
  const { readFile } = await import('node:fs/promises')
  const wav = await readFile('tests/fixtures/bar-files/float32-partial.wav')
  const sidecar = await readFile('tests/fixtures/bar-files/float32-partial.forget', 'utf8')
  const take = await restoreBarFiles({ wav: wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer, sidecar })
  expect(take.audio.samples).toEqual(Float32Array.of(-0, 1.25, -1.5, .125))
  expect(take.results[0].displayedAt).toBe(3)
  expect(take.results[0].guidance!.intendedTime).toBe(-.004)
  expect(take.barCount).toBe(1)
})
