// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NativeBarReplay } from './native-replay'
import type { ReplayState } from './replay'
import type { RecordedTake } from './recorded-take'
const native = vi.hoisted(() => ({ start: vi.fn(), read: vi.fn(), stop: vi.fn(), metronome: vi.fn(), capture: vi.fn() }))
vi.mock('forgettime-audio', () => ({ ForgettimeAudio: {
  startReplay: native.start, readReplay: native.read, stopReplay: native.stop,
  setReplayMetronome: native.metronome, start: native.capture,
} }))
let tick: FrameRequestCallback
const take = (): RecordedTake => ({ audio: { sampleRate: 48000, startFrame: 48000, samples: new Float32Array(96000) },
  origin: 1.000001, source: 'native', continuity: 1, settings: { bpm: 120, mode: 'straight', startSensitivity: 50 }, onsets: [], results: [], endReason: 'stopped' })
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { tick = callback; return 1 })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  native.start.mockReset().mockImplementation(async ({ sessionId, sampleRate, samples }) => ({ sessionId, sampleRate, frameCount: samples.length, diagnosticsSupported: true }))
  native.stop.mockReset().mockResolvedValue(undefined)
  native.metronome.mockReset().mockResolvedValue(undefined)
  native.capture.mockReset()
  native.read.mockReset().mockImplementation(async ({ sessionId }) => ({ sessionId, sampleRate: 48000, status: 'playing',
    audibleFrame: 36000, analyzedThroughFrame: 35968, clockQuality: 'hardware', onsets: [{ time: 0.50001, strength: 0.8, confidence: 0.95 }], diagnostics: { candidates: [], dropped: 0 } }))
})
afterEach(() => vi.unstubAllGlobals())
it('presents native output time and original native detections against the fixed fractional reference', async () => {
  const original = take()
  let state: ReplayState | undefined
  const replay = new NativeBarReplay(original, 0, value => { state = value }, message => { throw new Error(message) })
  await replay.start()
  await tick(999999)
  expect(state).toMatchObject({ time: 0.75, progress: 0.375, iteration: 0, snapshot: { status: 'playing', phaseOrigin: expect.closeTo(0.000001, 8), beat: 2 } })
  expect(state!.onsets[0].time).toBe(0.50001)
  expect(native.start.mock.calls[0][0].samples).toEqual(Array.from(original.audio.samples))
  expect(native.capture).not.toHaveBeenCalled()
  expect(original.onsets).toEqual([])
  await replay.stop()
})
it('stops a cancelled startup by its session and never publishes delayed completion', async () => {
  let resolve!: (value: any) => void
  native.start.mockImplementation(() => new Promise(value => { resolve = value }))
  const publish = vi.fn()
  const replay = new NativeBarReplay(take(), 0, publish, vi.fn())
  const starting = replay.start()
  const request = native.start.mock.calls[0][0]
  await replay.stop()
  resolve({ sessionId: request.sessionId, sampleRate: 48000, frameCount: 96000, diagnosticsSupported: true })
  await starting
  expect(publish).not.toHaveBeenCalled()
  expect(native.stop).toHaveBeenCalledWith({ sessionId: request.sessionId })
})
it.each(['clock', 'session', 'output', 'catch-up'])('releases output after a native %s failure', async failure => {
  const error = vi.fn()
  native.read.mockImplementation(async ({ sessionId }) => ({ sessionId: failure === 'session' ? 'obsolete' : sessionId,
    sampleRate: 48000, status: failure === 'output' ? 'error' : 'playing', reason: 'Output route changed',
    audibleFrame: failure === 'catch-up' ? 144000 : 36000, analyzedThroughFrame: failure === 'clock' ? 40000 : 35000,
    clockQuality: 'estimated', onsets: [], diagnostics: { candidates: [], dropped: 0 } }))
  const replay = new NativeBarReplay(take(), 0, vi.fn(), error)
  await replay.start()
  await tick(0)
  expect(error).toHaveBeenCalledOnce()
  expect(native.stop).toHaveBeenCalledOnce()
  expect(native.capture).not.toHaveBeenCalled()
})
it('does not advance presentation from queued output and preserves a silent grid over successive loops', async () => {
  let latest: ReplayState | undefined
  let frame = 0
  native.read.mockImplementation(async ({ sessionId }) => ({ sessionId, sampleRate: 48000, status: 'playing',
    audibleFrame: frame, analyzedThroughFrame: Math.floor(frame / 128) * 128, clockQuality: 'hardware', onsets: [], diagnostics: { candidates: [], dropped: 0 } }))
  const replay = new NativeBarReplay(take(), 0, state => { latest = state }, vi.fn())
  await replay.start()
  await tick(1e12)
  expect(latest!.time).toBe(0)
  for (frame = 24000; frame <= 240000; frame += 24000) await tick(1e12)
  expect(latest).toMatchObject({ iteration: 2, time: 5, onsets: [], snapshot: { status: 'playing', phaseOrigin: expect.closeTo(0.000001, 8) } })
  await replay.stop()
})
