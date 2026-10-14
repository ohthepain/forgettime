// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Capacitor } from '@capacitor/core'
import { usePractice } from './use-practice'
import { OnsetDetector } from './onset-detector'
import type { CaptureCallbacks } from './capture'
import type { SavedBarRecord, SavedBarRepository } from './saved-bars'
const hardware = vi.hoisted(() => ({ capture: vi.fn() }))
vi.mock('./capture', () => ({ createAudioCapture: hardware.capture }))
let callbacks: CaptureCallbacks
function storage(): SavedBarRepository {
  const records = new Map<string, SavedBarRecord>()
  return { list: async () => [...records.values()].map(({ wav, sidecar, ...summary }) => summary), read: async id => { const record = records.get(id); if (!record) throw new Error('Missing saved bar'); return structuredClone(record) }, save: async record => { records.set(record.id, structuredClone(record)) } }
}
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  hardware.capture.mockReset().mockImplementation((value: CaptureCallbacks) => { callbacks = value; return { start: async () => ({ source: 'web', sampleRate: 48000, timestampQuality: 'sample-clock' }), stop: async () => {}, setMetronome: () => {} } })
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
async function captureBar(repository: SavedBarRepository, rate: number, enterReview = true) {
  const hook = renderHook(() => usePractice(110, 'straight', 50, undefined, { savedBars: repository }))
  await act(() => hook.result.current.listen('auto'))
  const detector = new OnsetDetector()
  const samples = new Float32Array(7 * rate)
  for (let beat = 0; beat < 8; beat++) for (let i = 0; i < 256; i++) samples[Math.round((0.103 + beat * 60 / 110) * rate) + i] = (i % 2 ? -0.8 : 0.8) * Math.exp(-i / 100)
  act(() => {
    for (let startFrame = 0; startFrame < samples.length; startFrame += 997) {
      const pcm = samples.subarray(startFrame, startFrame + 997)
      const onsets = detector.process(pcm, startFrame / rate, rate)
      callbacks.onFrame({ source: 'web', timestampQuality: 'sample-clock', sampleRate: rate, time: detector.processedThrough ?? 0, level: 0, onsets, pcm: { startFrame, samples: pcm }, diagnostics: detector.drainDiagnostics() })
    }
  })
  if (enterReview) await act(() => hook.result.current.nextBar())
  return hook
}
it.each([44100, 48000])('saves only the selected fractional-frame bar and reopens exact PCM and original reference after restart at %i Hz', async rate => {
  const repository = storage()
  const first = await captureBar(repository, rate)
  const selected = first.result.current.reviewBar!
  const originalSamples = selected.audio.samples.slice()
  const expectedOrigin = selected.start - selected.audio.startFrame / rate
  await act(() => first.result.current.saveSelectedBar())
  expect(first.result.current.savedBars).toHaveLength(1)
  const id = first.result.current.savedBars[0].id
  first.unmount()
  const reopened = renderHook(() => usePractice(80, 'auto', 50, undefined, { savedBars: repository }))
  await act(() => reopened.result.current.openSavedBar(id))
  expect(reopened.result.current).toMatchObject({ source: 'off', captureMode: 'single', reviewBarCount: 1, reviewBarIndex: 0 })
  expect(reopened.result.current.recordedTake!.origin).toBe(expectedOrigin)
  expect(reopened.result.current.recordedTake!.audio.samples).toEqual(originalSamples)
  expect(reopened.result.current.recordedTake!.settings.bpm).toBe(110)
  expect(reopened.result.current.reviewBar!.complete).toBe(true)
  await act(() => reopened.result.current.saveSelectedBar())
  const nextId = reopened.result.current.savedBars.find(bar => bar.id !== id)!.id
  await act(() => reopened.result.current.openSavedBar(nextId))
  expect(reopened.result.current.reviewBarCount).toBe(1)
  expect(reopened.result.current.recordedTake!.origin).toBe(expectedOrigin)
  expect(reopened.result.current.recordedTake!.audio.samples).toEqual(originalSamples)
  expect(hardware.capture).toHaveBeenCalledOnce()
})

it('keeps the microphone off and releases pending file state when a stale reopen is cancelled', async () => {
  const repository = storage()
  const first = await captureBar(repository, 48000)
  await act(() => first.result.current.saveSelectedBar())
  const record = await repository.read(first.result.current.savedBars[0].id)
  let complete!: (value: SavedBarRecord) => void
  repository.read = () => new Promise(resolve => { complete = resolve })
  let opening!: Promise<void>
  act(() => { opening = first.result.current.openSavedBar(record.id) })
  await act(async () => { await Promise.resolve() })
  await act(() => first.result.current.stop())
  await act(async () => { complete(record); await opening })
  expect(first.result.current.libraryBusy).toBe(false)
  expect(first.result.current.source).toBe('off')
  expect(first.result.current.recordedTake!.source).toBe('web')
})

it('keeps originals and truncated diagnostics after tuning, and retains a saved pair when download is cancelled', async () => {
  const repository = storage(), first = await captureBar(repository, 48000)
  const take = first.result.current.recordedTake!
  take.diagnostics!.dropped = 19
  await act(() => first.result.current.configureDetector({ minimumRms: .04 }))
  await act(() => first.result.current.saveSelectedBar())
  const id = first.result.current.savedBars[0].id
  first.unmount()
  const reopened = renderHook(() => usePractice(80, 'auto', 50, undefined, { savedBars: repository, exportFile: async () => { throw new Error('Download cancelled.') } }))
  await act(() => reopened.result.current.openSavedBar(id))
  expect(reopened.result.current.recordedTake!.settings.detector!.minimumRms).toBe(.006)
  expect(reopened.result.current.recordedTake!.diagnostics!.dropped).toBe(19)
  expect(reopened.result.current.recordedTake!.analysis).toEqual({ implementation: 'forgettime-onset', version: '1' })
  expect(reopened.result.current.recordedTake!.diagnostics!.candidates.length).toBeGreaterThan(0)
  await act(() => reopened.result.current.exportSavedFile(id, 'wav'))
  expect(reopened.result.current.libraryError).toContain('local saved pair is retained')
  await act(() => reopened.result.current.openSavedBar(id))
  expect(reopened.result.current.reviewBarCount).toBe(1)
})
it('never reports save success before durable commit and leaves previous saved bars available after quota failure', async () => {
  const repository = storage(), hook = await captureBar(repository, 48000)
  await act(() => hook.result.current.saveSelectedBar())
  const id = hook.result.current.savedBars[0].id
  let fail!: (error: Error) => void
  repository.save = () => new Promise((_, reject) => { fail = reject })
  let saving!: Promise<void>
  act(() => { saving = hook.result.current.saveSelectedBar() })
  await act(async () => { while (!fail) await new Promise(resolve => setTimeout(resolve, 1)) })
  expect(hook.result.current.libraryBusy).toBe(true)
  expect(hook.result.current.libraryNotice).toBeNull()
  expect(hook.result.current.savedBars).toHaveLength(1)
  await act(async () => { fail(new Error('Quota exceeded')); await saving })
  expect(hook.result.current.libraryError).toBe('Quota exceeded')
  await act(() => hook.result.current.openSavedBar(id))
  expect(hook.result.current.reviewBarCount).toBe(1)
})
it('validates a saved pair before presenting both files to the native chooser and reports cancellation', async () => {
  const repository = storage(), exportPair = vi.fn().mockResolvedValue('cancelled')
  const captured = await captureBar(repository, 48000)
  await act(() => captured.result.current.saveSelectedBar())
  const id = captured.result.current.savedBars[0].id
  captured.unmount()
  const hook = renderHook(() => usePractice(120, 'auto', 50, undefined, { savedBars: repository, exportPair }))
  await act(() => hook.result.current.exportSavedPair(id))
  expect(exportPair).toHaveBeenCalledWith(id)
  expect(hook.result.current.libraryNotice).toMatch(/cancelled.*retained/i)
  const corrupt = await repository.read(id); corrupt.sidecar = '{}'; await repository.save(corrupt)
  await act(() => hook.result.current.exportSavedPair(id))
  expect(exportPair).toHaveBeenCalledOnce()
  expect(hook.result.current.libraryError).toBeTruthy()
})


it('disarms Auto before saving a completed take so later room sounds cannot replace its review', async () => {
  const repository = storage(), hook = await captureBar(repository, 48000, false)
  expect(hook.result.current).toMatchObject({ source: 'microphone', captureMode: 'auto', snapshot: { status: 'paused' } })
  const take = hook.result.current.recordedTake
  await act(() => hook.result.current.saveSelectedBar())
  expect(hook.result.current).toMatchObject({ source: 'off', captureMode: 'single' })
  expect(hook.result.current.savedBars).toHaveLength(1)
  act(() => callbacks.onFrame({ source: 'web', timestampQuality: 'sample-clock', sampleRate: 48000, time: 9, level: 1, onsets: [{ time: 9, strength: 1, confidence: 1 }] }))
  expect(hook.result.current.recordedTake).toBe(take)
})


it('allows prospective native detector tuning and reset before the first replay without opening the microphone', async () => {
  const platform = vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true)
  try {
    const hook = renderHook(() => usePractice(110, 'straight', 50, undefined, { savedBars: storage() }))
    await act(() => hook.result.current.openRecordedMaterial({ source: 'imported', provenance: { kind: 'import' }, audio: { startFrame: 0, sampleRate: 48000, samples: new Float32Array(96000) }, origin: 0, settings: { bpm: 120, mode: 'straight', startSensitivity: 50 }, continuity: 0, onsets: [], results: [], endReason: 'stopped' }))
    expect(hook.result.current.detectorSettingsSupported).toBe(true)
    await act(() => hook.result.current.configureDetector({ contrastRatio: 2.5 }))
    expect(hook.result.current.detectorSettings.contrastRatio).toBe(2.5)
    await act(() => hook.result.current.resetDetector())
    expect(hook.result.current.detectorSettings.contrastRatio).toBe(1.8)
    expect(hardware.capture).not.toHaveBeenCalled()
    expect(hook.result.current.source).toBe('off')
  } finally { platform.mockRestore() }
})


it('clears the previous import status when opening a saved bar', async () => {
  const repository = storage(), hook = await captureBar(repository, 48000)
  await act(() => hook.result.current.saveSelectedBar())
  const id = hook.result.current.savedBars[0].id, pair = await repository.read(id)
  const sidecar = new TextEncoder().encode(pair.sidecar)
  await act(() => hook.result.current.importFiles([{ name: 'saved.wav', size: pair.wav.byteLength, read: async () => pair.wav }, { name: 'saved.forget', size: sidecar.length, read: async () => sidecar.buffer }]))
  expect(hook.result.current.importNotice).toMatch(/restored/)
  await act(() => hook.result.current.openSavedBar(id))
  expect(hook.result.current.importNotice).toBeNull()
  expect(hook.result.current.recordedTake!.source).toBe('saved')
})
