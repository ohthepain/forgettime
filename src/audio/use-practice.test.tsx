// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { CaptureCallbacks, CaptureInfo } from './capture'
import { usePractice } from './use-practice'
import { usePreferences } from '../lib/preferences'
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

  it('retains actual PCM and original attacks, browses bars, and disables Auto for review', async () => {
    const { result } = renderHook(() => usePractice(120, 'auto'))
    await act(() => result.current.listen('auto'))
    const rate = 48000
    const detector = new OnsetDetector()
    const pcm = new Float32Array(6 * rate)
    for (const time of [0.1, 0.6, 1.1, 1.6, 2.1, 2.6, 3.1, 3.6]) {
      for (let i = 0; i < 256; i++) pcm[Math.round(time * rate) + i] = (i % 2 ? -0.8 : 0.8) * Math.exp(-i / 100)
    }
    act(() => {
      for (let startFrame = 0; startFrame < pcm.length; startFrame += 997) {
        const samples = pcm.subarray(startFrame, startFrame + 997)
        const onsets = detector.process(samples, startFrame / rate, rate)
        callbacks.onFrame({ ...info, time: detector.processedThrough ?? 0, level: 0, onsets, pcm: { startFrame, samples } })
      }
    })
    expect(result.current.recordedTake?.audio.samples.length).toBeGreaterThan(4 * rate)
    const take = result.current.recordedTake!
    expect(take.audio.samples).toEqual(pcm.slice(take.audio.startFrame, take.audio.startFrame + take.audio.samples.length))
    expect(take.onsets).toHaveLength(8)
    expect(take.results.length).toBeGreaterThan(0)
    expect(result.current.reviewBarCount).toBe(3)
    expect(result.current.reviewBarIndex).toBe(0) // last complete bar before final hit
    expect(result.current.reviewBar?.waveform.hits).toHaveLength(4)
    await act(() => result.current.nextBar())
    expect(result.current.reviewBarIndex).toBe(1)
    expect(result.current.reviewBar?.waveform.hits).toHaveLength(4)
    expect(result.current).toMatchObject({ source: 'off', captureMode: 'single' })
    await act(() => result.current.previousBar())
    expect(result.current.reviewBarIndex).toBe(0)
    expect(result.current.recordedTake).toBe(take)
  })

  it('retains original candidates and prevents replay tuning from changing live defaults', async () => {
    const { result } = renderHook(() => usePractice(120, 'straight', 0))
    await act(() => result.current.listen('auto'))
    const detector = new OnsetDetector()
    const rate = 48000
    const pcm = new Float32Array(3 * rate)
    for (const [time, amplitude] of [[0.1, 0.04], [0.6, 0.8], [1.1, 0.03]]) {
      for (let i = 0; i < 256; i++) pcm[Math.round(time * rate) + i] = (i % 2 ? -amplitude : amplitude) * Math.exp(-i / 100)
    }
    act(() => {
      for (let startFrame = 0; startFrame < pcm.length; startFrame += 997) {
        const samples = pcm.subarray(startFrame, startFrame + 997)
        const onsets = detector.process(samples, startFrame / rate, rate)
        callbacks.onFrame({ ...info, time: detector.processedThrough ?? 0, level: 0, onsets, pcm: { startFrame, samples }, diagnostics: detector.drainDiagnostics() })
      }
    })
    expect(result.current.liveDiagnostics.candidates.some(candidate => candidate.accepted && candidate.acquisition === 'started')).toBe(true)
    const origin = result.current.snapshot.phaseOrigin
    await act(() => result.current.configureSensitivity(90))
    expect(result.current.detectorSettings.minSeparationMs).toBe(18)
    expect(result.current.detectionSensitivity).toBe(50)
    expect(result.current.snapshot.phaseOrigin).toBe(origin)
    await act(() => result.current.stop())
    const take = result.current.recordedTake!
    expect(take.settings.detector?.minSeparationMs).toBe(18)
    expect(take.diagnostics?.candidates.some(candidate => candidate.accepted && candidate.acquisition === 'started')).toBe(true)
    expect(take.diagnostics?.dropped).toBe(0)
  })

  it('preserves valid take audio while explicitly reporting capped original diagnostics', async () => {
    const { result } = renderHook(() => usePractice(120, 'straight', 100))
    await act(() => result.current.listen('auto'))
    const rate = 8000
    const detector = new OnsetDetector()
    const pcm = Float32Array.from({ length: 20 * rate }, (_, i) => Math.floor(i / 32) % 2 ? (i % 2 ? -0.01 : 0.01) : 0)
    for (let second = 0; second < 20; second++) for (let i = 0; i < 32; i++) pcm[Math.round((second + 0.1) * rate) + i] = i % 2 ? -0.8 : 0.8
    act(() => {
      for (let startFrame = 0; startFrame < pcm.length; startFrame += 997) {
        const samples = pcm.subarray(startFrame, startFrame + 997)
        const onsets = detector.process(samples, startFrame / rate, rate)
        callbacks.onFrame({ ...info, sampleRate: rate, time: detector.processedThrough ?? 0, level: 0, onsets, pcm: { startFrame, samples }, diagnostics: detector.drainDiagnostics() })
      }
    })
    await act(() => result.current.stop())
    expect(result.current.recordedTake!.diagnostics!.candidates).toHaveLength(2048)
    expect(result.current.recordedTake!.diagnostics!.dropped).toBeGreaterThan(0)
    expect(result.current.recordedTake!.audio.samples.length).toBeGreaterThan(19 * rate)
    expect(result.current.liveDiagnostics.candidates).toHaveLength(2048)
    expect(result.current.liveDiagnostics.dropped).toBeGreaterThan(0)
  })

  it('retains signed PCM extrema and lets users inspect audio with no accepted hits', async () => {
    const { result } = renderHook(() => usePractice(120, 'auto'))
    await act(() => result.current.listen())
    const samples = new Float32Array(3 * 48000).fill(0.25)
    await act(async () => callbacks.onFrame({ ...info, time: 3, level: 0.25, onsets: [{ time: 0.1, strength: 0.8, confidence: 0.95 }], pcm: { startFrame: 0, samples } }))
    expect(result.current.reviewBar?.waveform.min[0]).toBe(0.25)
    expect(result.current.reviewBar?.complete).toBe(true)
    // Only the genuine timeout endpoint is retained, not the rest of this late packet.
    expect(result.current.recordedTake?.audio.samples.length).toBe(98400)
  })

  it('preserves only the latest take when a packet crosses a silence boundary', async () => {
    const { result } = renderHook(() => usePractice(120, 'auto'))
    await act(() => result.current.listen('auto'))
    act(() => callbacks.onFrame({ ...info, time: 6, level: 0.8,
      onsets: [0.1, 0.6, 3.1, 3.6].map(time => ({ time, strength: 0.8, confidence: 0.95 })),
      pcm: { startFrame: 0, samples: new Float32Array(6 * 48000).fill(-0.25) },
    }))
    expect(result.current.recordedTake?.origin).toBe(3.1)
    expect(result.current.recordedTake?.onsets.map(hit => hit.time)).toEqual([3.1, 3.6])
    expect(result.current.recordedTake?.results.map(hit => hit.time)).toEqual([3.6])
    expect(result.current.reviewBar?.waveform.max[0]).toBe(-0.25)
  })

  it('labels an interrupted partial take and never inserts PCM across an input gap', async () => {
    const { result } = renderHook(() => usePractice(120, 'auto'))
    await act(() => result.current.listen('auto'))
    act(() => callbacks.onFrame({ ...info, time: 0.5, level: 0.8,
      onsets: [{ time: 0.1, strength: 0.8, confidence: 0.95 }],
      pcm: { startFrame: 0, samples: new Float32Array(24000).fill(0.25) },
    }))
    act(() => callbacks.onDiscontinuity?.())
    const first = result.current.recordedTake!
    expect(first.endReason).toBe('interrupted')
    expect(result.current.reviewBar?.complete).toBe(false)
    expect(result.current.reviewBar?.audio.samples.length).toBe(19200)
    act(() => callbacks.onFrame({ ...info, time: 10.5, level: 0.8,
      onsets: [{ time: 10.1, strength: 0.8, confidence: 0.95 }],
      pcm: { startFrame: 480000, samples: new Float32Array(24000).fill(-0.25) },
    }))
    await act(() => result.current.stop())
    const second = result.current.recordedTake!
    expect(second.continuity).not.toBe(first.continuity)
    expect(second.audio.samples.length).toBeLessThan(24000)
    expect(second.onsets.map(hit => hit.time)).toEqual([10.1])
  })

  it('stops at the bounded recording limit and retains the valid take with a visible notice', async () => {
    const { result } = renderHook(() => usePractice(120, 'auto'))
    await act(() => result.current.listen('auto'))
    const rate = 8000
    await act(async () => {
      for (let second = 0; second <= 120; second++) callbacks.onFrame({ ...info, sampleRate: rate, time: second + 1, level: 0.8,
        onsets: [{ time: second + 0.1, strength: 0.8, confidence: 0.95 }],
        pcm: { startFrame: second * rate, samples: new Float32Array(rate) },
      })
    })
    expect(result.current).toMatchObject({ source: 'off', captureMode: 'single' })
    expect(result.current.recordedTake?.endReason).toBe('limit')
    expect(result.current.recordedTake?.audio.samples.length).toBe(120 * rate)
    expect(result.current.recordingNotice).toContain('2-minute limit')
    expect(result.current.reviewBarCount).toBe(60)
  })

  it('assigns a hit exactly on the bar boundary to the next bar', async () => {
    const { result } = renderHook(() => usePractice(120, 'auto'))
    await act(() => result.current.listen())
    act(() => callbacks.onFrame({ ...info, time: 2.6, level: 0.8,
      onsets: [0.1, 1.1, 2.1].map(time => ({ time, strength: 0.8, confidence: 0.95 })),
      pcm: { startFrame: 0, samples: new Float32Array(124800) },
    }))
    await act(() => result.current.stop())
    expect(result.current.reviewBar?.waveform.hits.map(hit => hit.time)).toEqual([0.1, 1.1])
    await act(() => result.current.nextBar())
    expect(result.current.reviewBar?.waveform.hits.map(hit => hit.time)).toEqual([2.1])
    expect(result.current.reviewBar?.waveform.hits[0].position).toBe(0)
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

  it('changes microphone gain without reopening capture or moving its reference', async () => {
    const setInputGain = vi.fn()
    mocked.create.mockImplementation((value: CaptureCallbacks) => {
      callbacks = value
      return { start: vi.fn().mockResolvedValue(info), stop: stopCapture, setMetronome, setInputGain }
    })
    const { result, rerender } = renderHook(({ gain }) => usePractice(120, 'auto', gain), { initialProps: { gain: 1 } })
    await act(() => result.current.listen())
    act(() => frame(100, [100]))
    rerender({ gain: 2 })
    expect(setInputGain).toHaveBeenLastCalledWith(2)
    act(() => frame(100.5, [100.5]))
    expect(result.current.snapshot.phaseOrigin).toBe(100)
    expect(mocked.create).toHaveBeenCalledOnce()
    expect(stopCapture).not.toHaveBeenCalled()
  })

  it.each(['web', 'native'] as const)('accepts detector-approved quiet %s attacks and measures Auto silence from the last accepted attack', async source => {
    const detector = new OnsetDetector()
    const rate = 48000
    const samples = new Float32Array(rate * 3)
    for (const [time, strength] of [[0.1, 0.8], [0.6, 0.08], [1.1, 0.8], [2.6, 0.08]]) {
      for (let i = 0; i < 128; i++) samples[Math.round(time * rate) + i] = i % 2 ? -strength : strength
    }
    const onsets = detector.process(samples, 0, rate)
    expect(onsets).toHaveLength(4) // Detector attempts remain available for inspection.
    const { result } = renderHook(() => usePractice(120, 'straight', 1))
    await act(() => result.current.listen('auto'))
    act(() => callbacks.onFrame({ ...info, source, time: 3, level: 0, onsets,
      pcm: { startFrame: 0, samples }, diagnostics: detector.drainDiagnostics() }))
    expect(result.current.snapshot).toMatchObject({ status: 'playing', phaseOrigin: onsets[0].time, lastHitTime: onsets[3].time })
    expect(result.current.waveform.hits.map(hit => hit.time)).toContain(onsets[3].time)
    expect(result.current.liveDiagnostics.candidates.filter(candidate => candidate.acquisition === 'below-start-level')).toHaveLength(0)
    act(() => callbacks.onFrame({ ...info, source, time: 4.59, level: 0, onsets: [] }))
    expect(result.current.snapshot.status).toBe('playing')
    act(() => callbacks.onFrame({ ...info, source, time: 4.6, level: 0, onsets: [] }))
    expect(result.current.snapshot.status).toBe('paused')
    expect(result.current.recordedTake?.onsets.map(hit => hit.time)).toEqual(onsets.map(hit => hit.time))
    expect(stopCapture).not.toHaveBeenCalled() // Auto keeps listening after the take ends.

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

  it('keeps imported/replay tuning out of the next live detector and sends microphone gain separately', async () => {
    const { result } = renderHook(() => usePractice(120, 'auto', 2))
    await act(() => result.current.configureSensitivity(0))
    expect(result.current.detectorSettings.minimumRms).toBe(.04)
    await act(() => result.current.listen())
    expect(mocked.create).toHaveBeenLastCalledWith(expect.any(Object), expect.objectContaining({
      inputGain: 2, detectorSettings: expect.objectContaining({ minimumRms: .002, contrastRatio: 1.8 }),
    }))
    expect(result.current.detectionSensitivity).toBe(0)
    await act(() => result.current.stop())
  })

  it('reduces future gain without moving beat one, and manual override lasts until the next take', async () => {
    vi.useFakeTimers()
    try {
      usePreferences.setState({ inputGain: 2 })
      const { result } = renderHook(() => usePractice(120, 'auto', usePreferences(state => state.inputGain)))
      await act(() => result.current.listen('auto'))
      act(() => callbacks.onFrame({ ...info, inputGain: 2, time: .1, level: 1,
        pcm: { startFrame: 0, samples: new Float32Array([1.5]) },
        onsets: [{ time: .1, confidence: .95, strength: .8 }] }))
      expect(result.current.gainAdjustment.adjusting).toBe(true)
      act(() => vi.advanceTimersByTime(1024))
      expect(usePreferences.getState().inputGain).toBeCloseTo(1.2)
      expect(result.current.snapshot.phaseOrigin).toBe(.1)
      act(() => result.current.manualInputGain())
      act(() => callbacks.onFrame({ ...info, inputGain: 1.2, time: .2, level: 1,
        pcm: { startFrame: 1, samples: new Float32Array([2]) }, onsets: [] }))
      expect(result.current.gainAdjustment.adjusting).toBe(false)
      act(() => frame(2.2))
      act(() => callbacks.onFrame({ ...info, inputGain: 1.2, time: 2.3, level: 1,
        pcm: { startFrame: 2, samples: new Float32Array([2]) }, onsets: [] }))
      expect(result.current.gainAdjustment.adjusting).toBe(true)
      await act(() => result.current.stop())
      const stoppedGain = usePreferences.getState().inputGain
      act(() => vi.advanceTimersByTime(2000))
      expect(usePreferences.getState().inputGain).toBe(stoppedGain)
    } finally { vi.useRealTimers() }
  })

})

it('snapshots the selected profile on explicit microphone start without enabling capture on restore', async () => {
  const profile = { family: 'mel', windowMs: 20, bands: 96, neighbor: 5, confirmation: 1, rearming: true, threshold: 2 };
  localStorage.setItem('forgettime-training-profile', JSON.stringify(profile));
  mocked.create.mockReset();
  mocked.create.mockImplementation(() => ({ start: vi.fn().mockResolvedValue(info), stop: vi.fn().mockResolvedValue(undefined), setMetronome: vi.fn() }));
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  try {
    const { result, unmount } = renderHook(() => usePractice(120, 'straight'));
    expect(mocked.create).not.toHaveBeenCalled();
    await act(() => result.current.listen());
    expect(mocked.create.mock.calls[0][1].profile).toEqual(profile);
    localStorage.removeItem('forgettime-training-profile');
    expect(mocked.create.mock.calls[0][1].profile).toEqual(profile);
    await act(() => result.current.stop());
    unmount();
  } finally { localStorage.removeItem('forgettime-training-profile'); cleanup(); vi.unstubAllGlobals(); }
});
