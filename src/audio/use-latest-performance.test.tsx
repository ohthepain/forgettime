// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { usePractice } from './use-practice'
import { DEFAULT_DETECTOR_SETTINGS } from './detector-contract'
import { sensitivitySettings } from './detector-sensitivity'
import type { CaptureCallbacks } from './capture'
import type { LatestPerformance, LatestPerformanceRepository } from './latest-performance'
import type { RecordedTake } from './recorded-take'
const hardware = vi.hoisted(() => ({ capture: vi.fn() }))
vi.mock('./capture', () => ({ createAudioCapture: hardware.capture }))
let callbacks: CaptureCallbacks
beforeEach(() => {
  hardware.capture.mockReset().mockImplementation((value: CaptureCallbacks) => {
    callbacks = value
    return { start: async () => ({ source: 'web', sampleRate: 8000, timestampQuality: 'sample-clock' }), stop: async () => {}, setMetronome: () => {} }
  })
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function take(): RecordedTake {
  const samples = new Float32Array(48000)
  samples.set([-0, 1.5, -.25])
  return { source: 'imported', audio: { samples, sampleRate: 8000, startFrame: 0 },
    origin: .01, continuity: 3, settings: { bpm: 120, mode: 'straight', startSensitivity: 50, detector: { ...DEFAULT_DETECTOR_SETTINGS } },
    onsets: [{ time: .01, strength: .8, confidence: .95 }], results: [], endReason: 'stopped' }
}
function memory() {
  let stored: LatestPerformance | null = null
  const repository: LatestPerformanceRepository = {
    read: vi.fn(async () => stored ? structuredClone(stored) : null),
    save: vi.fn(async value => { stored = structuredClone(value) }),
  }
  return repository
}
it('restores exact full-take PCM, original reference and tuned review after remount without capture', async () => {
  const repository = memory()
  const first = renderHook(() => usePractice(120, 'straight', 1, undefined, { latestPerformance: repository }))
  await act(async () => {})
  const original = take()
  await act(() => first.result.current.openRecordedMaterial(original))
  await act(() => first.result.current.nextBar())
  await act(() => first.result.current.configureSensitivity(80))
  await act(() => first.result.current.configureBalance(35))
  first.unmount()
  const next = renderHook(() => usePractice(100, 'auto', 1, undefined, { latestPerformance: repository }))
  await act(async () => {})
  expect(next.result.current).toMatchObject({ source: 'off', captureMode: 'single', reviewBarIndex: 1, detectionSensitivity: 80, frequencyBalance: 35, replayState: null })
  expect(next.result.current.detectorSettings).toEqual(sensitivitySettings(80))
  const restored = next.result.current.recordedTake!
  expect({ ...restored, audio: undefined }).toEqual({ ...original, audio: undefined })
  expect(Array.from(restored.audio.samples)).toEqual(Array.from(original.audio.samples))
  expect(Object.is(restored.audio.samples[0], -0)).toBe(true)
  expect(restored.audio.sampleRate).toBe(original.audio.sampleRate)
  expect(restored.audio.startFrame).toBe(original.audio.startFrame)
  expect(hardware.capture).not.toHaveBeenCalled()
})
it('persists a finished live take but does not checkpoint an active performance or erase the previous take', async () => {
  const repository = memory()
  const hook = renderHook(() => usePractice(120, 'straight', 1, undefined, { latestPerformance: repository }))
  await act(async () => {})
  await act(() => hook.result.current.listen())
  act(() => callbacks.onFrame({ source: 'web', sampleRate: 8000, timestampQuality: 'sample-clock', time: .1, level: .5,
    onsets: [{ time: .01, strength: .8, confidence: .95 }], pcm: { startFrame: 0, samples: new Float32Array(800).fill(.5) } }))
  expect(repository.save).not.toHaveBeenCalled()
  await act(() => hook.result.current.stop())
  expect(repository.save).toHaveBeenCalledOnce()
  const previous = await repository.read()
  await act(() => hook.result.current.listen())
  expect(await repository.read()).toEqual(previous)
})
it('ignores stale restoration after a new import and quietly tolerates storage failures', async () => {
  let resolve!: (value: LatestPerformance) => void
  const repository = { read: () => new Promise<LatestPerformance>(done => { resolve = done }), save: vi.fn(async () => { throw new Error('Quota') }) }
  const hook = renderHook(() => usePractice(120, 'straight', 1, undefined, { latestPerformance: repository }))
  const original = take(), fresh = { ...take(), origin: .2 }
  await act(() => hook.result.current.openRecordedMaterial(fresh))
  await act(async () => resolve({ take: original, review: { frequencyBalance: 100, barIndex: 1, detectionSensitivity: 50, detector: { ...DEFAULT_DETECTOR_SETTINGS } } }))
  expect(hook.result.current.recordedTake).toBe(fresh)
  expect(hook.result.current.error).toBeNull()
  expect(repository.save).toHaveBeenCalled()
})
it('quietly tolerates unavailable or unreadable storage', async () => {
  const repository = { read: async () => { throw new Error('Corrupt') }, save: vi.fn(async () => {}) }
  const hook = renderHook(() => usePractice(120, 'straight', 1, undefined, { latestPerformance: repository }))
  await act(async () => {})
  expect(hook.result.current.recordedTake).toBeNull()
  expect(hook.result.current.error).toBeNull()
  await act(() => hook.result.current.openRecordedMaterial(take()))
  expect(repository.save).toHaveBeenCalledOnce()
})
