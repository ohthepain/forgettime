// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaptureCallbacks, CaptureInfo } from './capture'
import { usePractice } from './use-practice'

const mocked = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('./capture', () => ({ createAudioCapture: mocked.create }))
const info: CaptureInfo = { source: 'web', sampleRate: 48000, timestampQuality: 'sample-clock' }
let callbacks: CaptureCallbacks
let stopCapture: ReturnType<typeof vi.fn>
function frame(time: number, attacks: number[] = []) {
  callbacks.onFrame({ ...info, time, level: 0.3, onsets: attacks.map(value => ({ time: value, confidence: 0.95, strength: 0.8 })) })
}

describe('live timing integration', () => {
  beforeEach(() => {
    mocked.create.mockReset()
    stopCapture = vi.fn().mockResolvedValue(undefined)
    mocked.create.mockImplementation((value: CaptureCallbacks) => { callbacks = value; return { start: vi.fn().mockResolvedValue(info), stop: stopCapture } })
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('uses capture timestamps for drift, beat counting and exact silence timeout', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(999_999)
    const { result } = renderHook(() => usePractice(120, 'auto'))
    await act(() => result.current.listen())
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

  it('resets the reference when settings change without reopening capture', async () => {
    const { result, rerender } = renderHook(({ bpm }) => usePractice(bpm, 'auto'), { initialProps: { bpm: 120 } })
    await act(() => result.current.listen())
    act(() => { for (let i = 0; i < 6; i += 1) frame(i * 0.5, [i * 0.5]) })
    expect(result.current.snapshot.status).toBe('playing')
    rerender({ bpm: 60 })
    expect(result.current.snapshot).toMatchObject({ status: 'listening', bpm: 60, beat: null })
    expect(result.current.source).toBe('microphone')
    expect(mocked.create).toHaveBeenCalledTimes(1)
  })

  it('clears a locked reference on input loss and reacquires from captured audio without reopening', async () => {
    const { result } = renderHook(() => usePractice(120, 'auto'))
    await act(() => result.current.listen())
    act(() => { for (let i = 0; i < 6; i++) frame(100 + i * 0.5, [100 + i * 0.5]) })
    expect(result.current.snapshot.phaseOrigin).toBe(100)
    act(() => callbacks.onDiscontinuity?.())
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
      return { start: () => new Promise<CaptureInfo>(resolve => { resolveStart = resolve }), stop: stopCapture }
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
    mocked.create.mockReturnValue({ start: vi.fn().mockRejectedValue(new Error('Microphone permission denied')), stop: stopCapture })
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
