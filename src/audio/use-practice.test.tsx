// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaptureCallbacks, CaptureInfo } from './capture'
import { usePractice } from './use-practice'
import { OnsetDetector } from './onset-detector'

const mocked = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('./capture', () => ({ createAudioCapture: mocked.create }))
const info: CaptureInfo = { source: 'web', sampleRate: 48000, timestampQuality: 'sample-clock' }
let callbacks: CaptureCallbacks
let stopCapture: ReturnType<typeof vi.fn>
let setMetronome: ReturnType<typeof vi.fn>
function frame(time: number, attacks: number[] = []) {
  callbacks.onFrame({ ...info, time, level: 0.3, onsets: attacks.map(value => ({ time: value, confidence: 0.95, strength: 0.8 })) })
}

describe('live timing integration', () => {
  beforeEach(() => {
    mocked.create.mockReset()
    stopCapture = vi.fn().mockResolvedValue(undefined)
    setMetronome = vi.fn()
    mocked.create.mockImplementation((value: CaptureCallbacks) => { callbacks = value; return { start: vi.fn().mockResolvedValue(info), stop: stopCapture, setMetronome } })
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('does not capture on mount and releases a single take after a full bar of silence', async () => {
    const { result } = renderHook(() => usePractice(120, 'auto'))
    expect(mocked.create).not.toHaveBeenCalled()
    await act(() => result.current.listen())
    act(() => frame(10, [10]))
    act(() => frame(11.999))
    expect(result.current.snapshot).toMatchObject({ status: 'playing', phaseOrigin: 10, beat: 4 })
    expect(stopCapture).not.toHaveBeenCalled()
    await act(async () => frame(12))
    expect(result.current.source).toBe('off')
    expect(stopCapture).toHaveBeenCalledOnce()
  })

  it('does not restart a single take from an onset delivered after its silence deadline', async () => {
    const { result } = renderHook(() => usePractice(120, 'auto'))
    await act(() => result.current.listen())
    act(() => frame(10, [10]))
    await act(async () => frame(12.1, [12.05]))
    expect(result.current.source).toBe('off')
    expect(result.current.snapshot.phaseOrigin).toBeNull()
  })

  it('cannot reopen after Stop while an earlier capture is still releasing', async () => {
    const { result } = renderHook(() => usePractice(120, 'auto'))
    await act(() => result.current.listen())
    let release!: () => void
    stopCapture.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
    let opening!: Promise<void>
    await act(async () => { opening = result.current.listen('auto'); await Promise.resolve() })
    await act(() => result.current.stop())
    await act(async () => { release(); await opening })
    expect(result.current.source).toBe('off')
    expect(result.current.captureMode).toBe('single')
    expect(mocked.create).toHaveBeenCalledOnce()
  })

  it.each([120, 60])('keeps buffered PCM attacks just before the silence deadline at %i BPM', async bpm => {
    const { result } = renderHook(() => usePractice(bpm, 'auto'))
    await act(() => result.current.listen())
    const detector = new OnsetDetector()
    const rate = 48000
    const bar = 240 / bpm
    const pcm = new Float32Array(Math.ceil((2 * bar + 0.2) * rate))
    // Synthetic transients, not evidence of acoustic-kit accuracy.
    for (const start of [0.1, 0.1 + bar - 0.001]) {
      for (let i = 0; i < 256; i++) pcm[Math.round(start * rate) + i] = (i % 2 ? -0.8 : 0.8) * Math.exp(-i / 100)
    }
    let cursor = 0
    const sendUntil = (end: number) => {
      while (cursor < Math.min(pcm.length, end * rate)) {
        const block = pcm.subarray(cursor, cursor + 101)
        const onsets = detector.process(block, cursor / rate, rate)
        cursor += block.length
        callbacks.onFrame({ ...info, time: detector.processedThrough ?? 0, onsets, level: 0 })
      }
    }
    act(() => sendUntil(bar + 0.102))
    expect(result.current.source).toBe('microphone')
    expect(result.current.snapshot.phaseOrigin).toBeCloseTo(0.1, 2)
    expect(result.current.snapshot.lastHitTime).toBeCloseTo(bar + 0.099, 2)
    act(() => sendUntil(2 * bar + 0.09))
    expect(result.current.source).toBe('microphone')
    await act(async () => sendUntil(2 * bar + 0.2))
    expect(result.current.source).toBe('off')
  })

  it('holds the completed display in Auto and starts the next take without inheriting its reference', async () => {
    const { result } = renderHook(() => usePractice(120, 'auto'))
    await act(() => result.current.listen('auto'))
    act(() => callbacks.onFrame({ ...info, time: 10.1, level: 0.8, onsets: [{ time: 10, strength: 0.8, confidence: 0.95 }], waveform: [{ time: 10, duration: 0.02, min: -0.8, max: 0.8 }] }))
    act(() => frame(12))
    const held = result.current.waveform
    expect(held.review).toBe('partial')
    expect(result.current.captureMode).toBe('auto')
    act(() => frame(13))
    expect(result.current.waveform).toEqual(held)
    act(() => frame(14, [14]))
    expect(result.current.snapshot).toMatchObject({ status: 'playing', phaseOrigin: 14, beat: 1 })
    expect(result.current.waveform.review).toBeNull()
    expect(stopCapture).not.toHaveBeenCalled()
    await act(() => result.current.stop())
    act(() => frame(20, [20]))
    expect(result.current).toMatchObject({ source: 'off', captureMode: 'single' })
  })

  it('updates and mutes output without resetting the beat, and keeps output failures separate from capture', async () => {
    const { result, rerender } = renderHook(({ enabled, thresholdMs }) => usePractice(120, 'auto', 50, { enabled, mode: 'always', thresholdMs }),
      { initialProps: { enabled: true, thresholdMs: 100 } })
    await act(() => result.current.listen())
    act(() => frame(100.02, [100]))
    expect(setMetronome).toHaveBeenLastCalledWith({ origin: 100, bpm: 120, fromBeat: 1, untilTime: expect.closeTo(100.37), stopTime: 102 })
    expect(result.current.metronomeActive).toBe(true)
    rerender({ enabled: false, thresholdMs: 70 })
    expect(setMetronome).toHaveBeenLastCalledWith(null)
    expect(result.current.snapshot.phaseOrigin).toBe(100)
    expect(result.current.metronomeActive).toBe(false)
    rerender({ enabled: true, thresholdMs: 70 })
    act(() => callbacks.onOutputError?.('Output unavailable'))
    act(() => frame(100.5, [100.5]))
    expect(result.current.outputNotice).toBe('Output unavailable')
    expect(result.current.metronomeActive).toBe(false)
    expect(result.current.snapshot.phaseOrigin).toBe(100)
    expect(result.current.source).toBe('microphone')
    expect(stopCapture).not.toHaveBeenCalled()
    act(() => callbacks.onDiscontinuity?.())
    expect(setMetronome).toHaveBeenLastCalledWith(null)
  })

  it('uses capture timestamps for drift, beat counting and exact silence timeout', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(999_999)
    const { result } = renderHook(() => usePractice(120, 'auto'))
    await act(() => result.current.listen('auto'))
    expect(result.current.source).toBe('microphone')
    act(() => {
      for (let i = 0; i < 6; i += 1) frame(100 + i * 0.5, [100 + i * 0.5])
      frame(103.02, [103.02])
      frame(103.28)
    })
    expect(result.current.snapshot.phaseOrigin).toBe(100)
    expect(result.current.snapshot.hits.at(-1)?.errorMs).toBeCloseTo(20)
    act(() => frame(104))
    expect(result.current.snapshot.beat).toBe(1)
    act(() => frame(105.019))
    expect(result.current.snapshot.status).toBe('playing')
    act(() => frame(105.02))
    expect(result.current.snapshot.status).toBe('paused')
    expect(result.current.snapshot.beat).toBeNull()
    expect(mocked.create).toHaveBeenCalledTimes(1)
  })

  it('aligns the real envelope and immediate detected markers to the beat, wraps, and retains a review on stop', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(123456789)
    const { result } = renderHook(() => usePractice(120, 'auto'))
    await act(() => result.current.listen())
    const send = (time: number, start: number, peak: number, attacks: number[]) => callbacks.onFrame({
      ...info, time, level: peak,
      waveform: [{ time: start, duration: 0.02, min: -peak, max: peak }],
      onsets: attacks.map(time => ({ time, strength: 0.8, confidence: 0.95 })),
    })
    act(() => send(100.1, 100, 0.8, [100]))
    expect(result.current.snapshot.hits).toEqual([]) // The anchor has no timing score.
    expect(result.current.waveform.hits[0].position).toBe(0) // But it is a real detected hit.
    expect(result.current.waveform.max[0]).toBe(0.8)
    act(() => send(101.6, 101.5, 0.3, [101.5]))
    act(() => send(102.02, 102, 0, []))
    expect(result.current.waveform.max[0]).toBe(0)
    expect(result.current.waveform.max[384]).toBe(0.3)
    expect(result.current.waveform.hits.map(hit => hit.position)).toEqual([0.75])
    expect(result.current.waveform.progress).toBeCloseTo(0.01)
    await act(() => result.current.stop())
    expect(result.current.waveform.review).toBe('partial')
    expect(result.current.waveform.hits.map(hit => hit.position)).toEqual([0, 0.75])
    expect(result.current.waveform.max[0]).toBe(0.8)
    await act(() => result.current.listen())
    expect(result.current.waveform).toMatchObject({ min: [], hits: [], progress: null, review: null })
  })

  it('resets the reference when settings change without reopening capture', async () => {
    const { result, rerender } = renderHook(({ bpm }) => usePractice(bpm, 'auto'), { initialProps: { bpm: 120 } })
    await act(() => result.current.listen())
    act(() => { for (let i = 0; i < 6; i += 1) frame(i * 0.5, [i * 0.5]) })
    expect(result.current.snapshot.status).toBe('playing')
    rerender({ bpm: 60 })
    expect(result.current.snapshot).toMatchObject({ status: 'listening', bpm: 60, beat: null })
    expect(result.current.waveform.progress).toBeNull()
    expect(result.current.source).toBe('microphone')
    expect(mocked.create).toHaveBeenCalledTimes(1)
  })

  it('clears a locked reference on input loss and reacquires from captured audio without reopening', async () => {
    const { result } = renderHook(() => usePractice(120, 'auto'))
    await act(() => result.current.listen())
    act(() => { for (let i = 0; i < 6; i++) frame(100 + i * 0.5, [100 + i * 0.5]) })
    expect(result.current.snapshot.phaseOrigin).toBe(100)
    expect(result.current.waveform.hits.length).toBeGreaterThan(0)
    act(() => callbacks.onDiscontinuity?.())
    expect(result.current.waveform).toMatchObject({ min: [], hits: [], progress: null })
    expect(result.current.snapshot).toMatchObject({ status: 'listening', phaseOrigin: null, beat: null, hits: [] })
    expect(result.current.captureNotice).toContain('input interrupted')
    expect(result.current.source).toBe('microphone')
    act(() => frame(106))
    expect(result.current.captureNotice).toContain('input restored')
    act(() => frame(106.1, [106.1]))
    expect(result.current.snapshot).toMatchObject({ status: 'playing', phaseOrigin: 106.1, beat: 1 })
    expect(result.current.captureNotice).toBeNull()
    expect(mocked.create).toHaveBeenCalledOnce()
    expect(stopCapture).not.toHaveBeenCalled()
  })

  it('applies an edited sensitivity to waiting capture without reopening the mic or moving a live beat', async () => {
    const { result, rerender } = renderHook(({ sensitivity }) => usePractice(120, 'auto', sensitivity), { initialProps: { sensitivity: 0 } })
    await act(() => result.current.listen())
    const quiet = (time: number) => callbacks.onFrame({ ...info, time, level: 0.03, onsets: [{ time, strength: 0.08, confidence: 0.9 }] })
    act(() => quiet(100))
    expect(result.current.snapshot.status).toBe('listening')
    rerender({ sensitivity: 100 })
    act(() => quiet(101))
    expect(result.current.snapshot).toMatchObject({ status: 'playing', beat: 1, phaseOrigin: 101 })
    rerender({ sensitivity: 0 })
    act(() => { quiet(101.5); frame(101.75) })
    expect(result.current.snapshot.phaseOrigin).toBe(101)
    expect(result.current.snapshot.hits.at(-1)?.time).toBe(101.5)
    expect(mocked.create).toHaveBeenCalledOnce()
  })

  it('ignores stale frames and a delayed permission success after stop', async () => {
    let resolveStart!: (value: CaptureInfo) => void
    mocked.create.mockImplementation((value: CaptureCallbacks) => {
      callbacks = value
      return { start: () => new Promise<CaptureInfo>(resolve => { resolveStart = resolve }), stop: stopCapture, setMetronome: vi.fn() }
    })
    const { result } = renderHook(() => usePractice(120, 'auto'))
    let listening!: Promise<void>
    await act(async () => { listening = result.current.listen(); await Promise.resolve() })
    expect(result.current.busy).toBe(true)
    await act(() => result.current.stop())
    await act(async () => { resolveStart(info); await listening })
    act(() => frame(200, [200]))
    expect(result.current).toMatchObject({ source: 'off', busy: false })
    expect(result.current.snapshot.status).toBe('idle')
    expect(stopCapture).toHaveBeenCalled()
  })

  it('keeps permission errors visible and leaves the engine stopped', async () => {
    mocked.create.mockReturnValue({ start: vi.fn().mockRejectedValue(new Error('Microphone permission denied')), stop: stopCapture, setMetronome: vi.fn() })
    const { result } = renderHook(() => usePractice(120, 'auto'))
    await act(() => result.current.listen())
    expect(result.current).toMatchObject({ source: 'off', busy: false, error: 'Microphone permission denied' })
    expect(result.current.snapshot.status).toBe('idle')
  })

  it('labels demonstration generation separately and does not open the microphone', async () => {
    const { result } = renderHook(() => usePractice(120, 'auto'))
    await act(() => result.current.simulate())
    expect(result.current.source).toBe('simulation')
    expect(mocked.create).not.toHaveBeenCalled()
    expect(requestAnimationFrame).toHaveBeenCalled()
    await act(() => result.current.stop())
    expect(result.current.source).toBe('off')
  })
})
