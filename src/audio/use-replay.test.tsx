// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { usePractice } from './use-practice'
import { OnsetDetector } from './onset-detector'
import type { CaptureCallbacks } from './capture'
const hardware = vi.hoisted(() => ({ capture: vi.fn() }))
vi.mock('./capture', () => ({ createAudioCapture: hardware.capture }))
let callbacks: CaptureCallbacks
let tick: FrameRequestCallback
class OutputContext {
  static latest: OutputContext
  static resumeGate: (() => Promise<void>) | null = null
  clicks: number[] = []
  createOscillator() { return { frequency: { value: 0 }, connect: vi.fn(), disconnect: vi.fn(), start: (time: number) => this.clicks.push(time), stop: vi.fn() } }
  createGain() { return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() } }
  currentTime = 0
  state = 'running'
  destination = {}
  source = { buffer: null as { samples: Float32Array } | null, loop: false, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn() }
  constructor() { OutputContext.latest = this }
  createBuffer(_channels: number, length: number) { return { samples: new Float32Array(length), copyToChannel(samples: Float32Array) { this.samples.set(samples) } } }
  createBufferSource() { return this.source }
  resume = vi.fn(() => OutputContext.resumeGate?.() ?? Promise.resolve())
  close = vi.fn().mockResolvedValue(undefined)
}
beforeEach(() => {
  OutputContext.resumeGate = null
  hardware.capture.mockReset().mockImplementation((value: CaptureCallbacks) => {
    callbacks = value
    return { start: async () => ({ source: 'web', sampleRate: 48000, timestampQuality: 'sample-clock' }), stop: vi.fn().mockResolvedValue(undefined), setMetronome: vi.fn() }
  })
  vi.stubGlobal('AudioContext', OutputContext)
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { tick = fn; return 1 })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
async function take(packet = 997, rate = 48000, attacks = [0.1, 0.6, 1.1, 1.6, 2.1, 2.6, 3.1, 3.6], amplitude = 0.8) {
  const hook = renderHook(() => usePractice(120, 'straight', 50, { enabled: false, mode: 'always', thresholdMs: 100 }))
  await act(() => hook.result.current.listen('auto'))
  const detector = new OnsetDetector()
  const pcm = new Float32Array(6 * rate)
  for (const time of attacks) {
    for (let i = 0; i < 256; i++) pcm[Math.round(time * rate) + i] = (i % 2 ? -amplitude : amplitude) * Math.exp(-i / 100)
  }
  act(() => {
    for (let startFrame = 0; startFrame < pcm.length; startFrame += packet) {
      const samples = pcm.subarray(startFrame, startFrame + packet)
      const onsets = detector.process(samples, startFrame / rate, rate)
      callbacks.onFrame({ source: 'web', timestampQuality: 'sample-clock', sampleRate: rate, time: detector.processedThrough ?? 0, level: 0, onsets, pcm: { startFrame, samples } })
    }
  })
  return hook
}
function advance(seconds: number) { act(() => { OutputContext.latest.currentTime = seconds; tick(999999) }) }
it('loops selected source audio against its established reference with microphone and Auto off', async () => {
  const { result } = await take()
  const original = result.current.recordedTake!
  const samples = result.current.reviewBar!.audio.samples.slice()
  await act(() => result.current.playBar())
  expect(result.current).toMatchObject({ source: 'replay', captureMode: 'single' })
  expect(OutputContext.latest.source.loop).toBe(true)
  expect(OutputContext.latest.source.buffer!.samples).toEqual(samples)
  expect(result.current.snapshot).toMatchObject({ status: 'playing', phaseOrigin: 0, beat: 1 })
  advance(6.8)
  expect(result.current.snapshot).toMatchObject({ status: 'playing', phaseOrigin: 0, beat: 2 })
  expect(result.current.replayState?.iteration).toBe(3)
  expect(result.current.replayState?.onsets.length).toBeGreaterThan(0)
  expect(result.current.recordedTake).toBe(original)
  expect(hardware.capture).toHaveBeenCalledOnce()
})
it('starts equivalent fresh runs on resume, settings restart and bar change without changing original results', async () => {
  const { result } = await take(101)
  const original = structuredClone(result.current.recordedTake!.results)
  await act(() => result.current.playBar())
  advance(2.8)
  const first = result.current.replayState!
  const output = OutputContext.latest
  await act(() => result.current.stop())
  expect(output.source.stop).toHaveBeenCalled()
  expect(result.current.reviewBarIndex).toBe(0)
  await act(() => result.current.playBar())
  advance(2.8)
  const compare = (state: typeof first) => state.results.map(({ id, ...hit }) => hit)
  expect(compare(result.current.replayState!)).toEqual(compare(first))
  expect(result.current.replayState!.run).not.toBe(first.run)
  await act(() => result.current.restartReplay())
  expect(result.current.captureTime).toBe(0)
  advance(2.8)
  expect(compare(result.current.replayState!)).toEqual(compare(first))
  await act(() => result.current.nextBar())
  expect(result.current).toMatchObject({ source: 'replay', reviewBarIndex: 1, captureTime: 0 })
  expect(OutputContext.latest.source.buffer!.samples).toEqual(result.current.reviewBar!.audio.samples)
  expect(result.current.recordedTake!.results).toEqual(original)
})
it.each([44100, 48000])('keeps results sample-based through delayed callbacks and boundary attacks at %i Hz', async rate => {
  const first = await take(101, rate)
  await act(() => first.result.current.playBar())
  for (let time = 0.017; time < 4.8; time += 0.017) advance(time)
  advance(4.8)
  const immediate = first.result.current.replayState!
  expect(immediate.onsets.filter(hit => hit.iteration === 1)).toHaveLength(4)
  expect(immediate.onsets.find(hit => hit.iteration === 1)?.position).toBeCloseTo(0, 2)
  expect(immediate.results.find(hit => hit.iteration === 1)?.errorMs).toBeCloseTo(0, 0)
  first.unmount()
  const delayed = await take(4096, rate)
  await act(() => delayed.result.current.playBar())
  advance(4.8)
  const stripId = ({ id, ...hit }: typeof immediate.results[number]) => hit
  expect(delayed.result.current.replayState!.onsets).toEqual(immediate.onsets)
  expect(delayed.result.current.replayState!.results.map(stripId)).toEqual(immediate.results.map(stripId))
})
it('continues a sparse selected bar without reacquiring the reference', async () => {
  // Keep capture alive with two hits less than one bar apart, then manually preserve trailing PCM.
  const { result } = await take(997, 48000, [0.1, 1.6, 3.1])
  await act(() => result.current.nextBar())
  // The next complete bar contains one hit, then a rest longer than a bar over repeated source.
  await act(() => result.current.playBar())
  advance(10.8)
  expect(result.current.snapshot).toMatchObject({ status: 'playing', phaseOrigin: 0 })
  expect(result.current.replayState?.iteration).toBe(5)
})
it('refuses incomplete captured bars instead of padding unavailable audio', async () => {
  const { result } = await take()
  await act(() => result.current.nextBar())
  await act(() => result.current.nextBar())
  expect(result.current.reviewBar?.complete).toBe(false)
  await act(() => result.current.playBar())
  expect(result.current.source).toBe('off')
  expect(result.current.error).toContain('complete recorded bar')
})

it('renders metronome separately without changing source samples, detections or the fixed reference', async () => {
  const { result } = await take()
  await act(() => result.current.playBar())
  advance(0.4)
  expect(OutputContext.latest.clicks).toEqual([])
  // Exercise the public output setting while the selected source remains unchanged.
  await act(() => result.current.stop())
  cleanup()
  const hook = renderHook(({ enabled }) => usePractice(120, 'straight', 50, { enabled, mode: 'always', thresholdMs: 100 }), { initialProps: { enabled: false } })
  await act(() => hook.result.current.listen('auto'))
  const detector = new OnsetDetector()
  const pcm = new Float32Array(3 * 48000)
  for (const time of [0.1, 0.6]) for (let i = 0; i < 256; i++) pcm[Math.round(time * 48000) + i] = (i % 2 ? -0.8 : 0.8) * Math.exp(-i / 100)
  await act(async () => {
    for (let startFrame = 0; startFrame < pcm.length; startFrame += 1024) {
      const samples = pcm.subarray(startFrame, startFrame + 1024)
      const onsets = detector.process(samples, startFrame / 48000, 48000)
      callbacks.onFrame({ source: 'web', timestampQuality: 'sample-clock', sampleRate: 48000, time: detector.processedThrough ?? 0, level: 0, onsets, pcm: { startFrame, samples } })
    }
  })
  await act(() => hook.result.current.playBar())
  advance(0.4)
  hook.rerender({ enabled: true })
  advance(0.41)
  expect(OutputContext.latest.clicks).toContain(0.5)
  advance(1.8)
  const withClick = hook.result.current.replayState!.onsets
  hook.rerender({ enabled: false })
  await act(() => hook.result.current.restartReplay())
  advance(1.8)
  expect(hook.result.current.replayState!.onsets).toEqual(withClick)
})
it('keeps an established silent source running for multiple bars without inventing attacks', async () => {
  const { BrowserBarReplay } = await import('./replay')
  let latest: import('./replay').ReplayState | undefined
  const replay = new BrowserBarReplay({ audio: { startFrame: 0, sampleRate: 48000, samples: new Float32Array(96000) }, source: 'web', continuity: 0, origin: 0, settings: { bpm: 120, mode: 'straight', startSensitivity: 0 }, onsets: [], results: [], endReason: 'stopped' }, 0, state => { latest = state }, message => { throw new Error(message) })
  replay.setMetronome({ enabled: false, mode: 'always', thresholdMs: 100 })
  await replay.start()
  advance(12.75)
  expect(latest).toMatchObject({ iteration: 6, snapshot: { status: 'playing', phaseOrigin: 0, beat: 2 }, onsets: [], results: [] })
  await replay.stop()
})
it('releases output on interruption and starts fresh only on deliberate replay', async () => {
  const { result } = await take()
  await act(() => result.current.playBar())
  const output = OutputContext.latest
  output.state = 'suspended'
  advance(0.5)
  expect(result.current.source).toBe('off')
  expect(result.current.error).toContain('interrupted')
  expect(output.source.stop).toHaveBeenCalled()
  // Interruption must still allow a deliberate new run from the selected beginning.
  await act(() => result.current.playBar())
  expect(result.current).toMatchObject({ source: 'replay', captureTime: 0 })
  expect(result.current.error).toBeNull()
})

it('cannot revive playback after cancelling delayed audio activation', async () => {
  const { result } = await take()
  let resume!: () => void
  OutputContext.resumeGate = () => new Promise<void>(resolve => { resume = resolve })
  let opening!: Promise<void>
  await act(async () => { opening = result.current.playBar(); await Promise.resolve(); await Promise.resolve() })
  await act(() => result.current.stop())
  await act(async () => { resume(); await opening })
  expect(result.current.source).toBe('off')
  expect(OutputContext.latest.source.start).not.toHaveBeenCalled()
  expect(OutputContext.latest.close).toHaveBeenCalledOnce()
})
it('delivers each newly resolved score once even when presentation callbacks span several beats', async () => {
  const { result } = await take()
  await act(() => result.current.playBar())
  advance(2.8)
  const first = result.current.replayState!
  expect(first.snapshot.hits.map(hit => hit.time)).toEqual(first.results.map(hit => hit.time))
  expect(new Set(first.snapshot.hits.map(hit => hit.id)).size).toBe(first.snapshot.hits.length)
  advance(2.81)
  expect(result.current.snapshot.hits.every(hit => hit.time > 1.5)).toBe(true)
})
it('restarts a selected replay with real detector settings while preserving its PCM, grid and original results', async () => {
  const { result } = await take(997, 48000, undefined, 0.2)
  const original = result.current.recordedTake!
  const samples = result.current.reviewBar!.audio.samples.slice()
  await act(() => result.current.playBar())
  advance(2.8)
  const firstRun = result.current.replayState!.run
  const defaultOnsets = result.current.replayState!.onsets
  expect(result.current.replayState!.candidates.some(candidate => candidate.reasons.includes('warming-up'))).toBe(true)
  expect(result.current.replayState!.onsets.length).toBeGreaterThan(0)
  await act(() => result.current.configureDetector({ minimumRms: 0.1, contrastRatio: 4 }))
  expect(result.current.replayState!.run).toBe(firstRun + 1)
  expect(result.current.captureTime).toBe(0)
  advance(2.8)
  expect(result.current.snapshot.phaseOrigin).toBe(0)
  expect(result.current.recordedTake).toBe(original)
  expect(OutputContext.latest.source.buffer!.samples).toEqual(samples)
  expect(result.current.replayState!.candidates.some(candidate => !candidate.accepted && candidate.reasons.includes('contrast'))).toBe(true)
  expect(result.current.replayState!.settings).toMatchObject({ version: 1, minimumRms: 0.1, contrastRatio: 4 })
  expect(result.current.replayState!.onsets).toEqual([])
  await act(() => result.current.resetDetector())
  expect(result.current.detectorSettings).toMatchObject({ version: 1, minimumRms: 0.006, contrastRatio: 1.8, minSeparationMs: 18, recoverySeconds: 4 })
  advance(2.8)
  expect(result.current.replayState!.onsets).toEqual(defaultOnsets)
})
it('keeps the beat in 1–4 when imported musical beat one starts a fraction after sample zero', async () => {
  const hook = renderHook(() => usePractice(120, 'straight', 50, { enabled: false, mode: 'always', thresholdMs: 100 }))
  await act(() => hook.result.current.openRecordedMaterial({ source: 'imported', barCount: 1, continuity: 0, origin: .000005, audio: { startFrame: 0, sampleRate: 48000, samples: new Float32Array(96000) }, settings: { bpm: 120, mode: 'straight', startSensitivity: 50 }, onsets: [], results: [], endReason: 'stopped' }))
  await act(() => hook.result.current.playBar())
  expect(hook.result.current.snapshot.beat).toBe(4)
  advance(.06)
  expect(hook.result.current.snapshot.beat).toBe(1)
  expect(hook.result.current.recordedTake!.origin).toBe(.000005)
})
