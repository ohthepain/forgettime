// @vitest-environment jsdom
/** Opt-in host Java integration; generated PCM is not physical microphone evidence. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { NativeAudioFrame } from 'forgettime-audio'
import { usePractice } from '../../../src/audio/use-practice'

const bridge = vi.hoisted(() => ({ callbacks: new Map<string, (event: any) => void>(), stop: vi.fn(), ack: vi.fn() }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, isPluginAvailable: () => true } }))
vi.mock('forgettime-audio', () => ({ ForgettimeAudio: {
  start: async () => ({ sessionId: 'android-host', sampleRate: 48000, timestampQuality: 'sample-clock' }),
  stop: bridge.stop,
  setMetronome: async () => {},
  acknowledgeFrame: bridge.ack,
  addListener: async (name: string, callback: (event: unknown) => void) => {
    bridge.callbacks.set(name, callback)
    return { remove: async () => { bridge.callbacks.delete(name) } }
  },
} }))

describe.skipIf(!process.env.FORGETTIME_NATIVE_HOST_TESTS)('Android native PCM through capture and practice', () => {
  let directory: string
  const frames = new Map<number, NativeAudioFrame[]>()
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'forgettime-android-workflow-'))
    const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin') : ''
    execFileSync(join(java, 'javac'), ['-d', directory,
      ...['DrumOnsetDetector', 'WaveformEnvelopeCapture', 'NativeCaptureStream'].map(name => resolve(`plugins/forgettime-audio/android/src/main/java/app/forgettime/audio/${name}.java`)),
      resolve('plugins/forgettime-audio/tests/AndroidCaptureRunner.java')])
    expect(execFileSync(join(java, 'java'), ['-cp', directory, 'AndroidCaptureRunner'], { encoding: 'utf8' })).toContain('contracts passed')
    for (const rate of [44100, 48000]) frames.set(rate, execFileSync(join(java, 'java'), ['-cp', directory, 'AndroidCaptureRunner', String(rate)],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim().split('\n').map(line => JSON.parse(line)))
  }, 20000)
  afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }) })
  beforeEach(() => {
    bridge.callbacks.clear()
    bridge.stop.mockReset().mockResolvedValue(undefined)
    bridge.ack.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it.each([44100, 48000])('retains original native PCM/attacks and reviews multiple bars after sample-clock silence at %i Hz', async rate => {
    const { result } = renderHook(() => usePractice(120, 'auto'))
    await act(() => result.current.listen())
    const callback = bridge.callbacks.get('audioFrame')!
    await act(async () => { for (const frame of frames.get(rate)!) callback(frame) })
    const take = result.current.recordedTake!
    expect(result.current.source).toBe('off')
    expect(bridge.stop).toHaveBeenCalledOnce()
    expect(take).toMatchObject({ source: 'native', endReason: 'silence' })
    expect(take.origin).toBeCloseTo(0.1, 2)
    expect(take.onsets).toHaveLength(8)
    const original = frames.get(rate)!.flatMap(frame => frame.onsets).slice(0, 8)
    expect(take.onsets).toEqual(original)
    expect((take.audio.startFrame + take.audio.samples.length) / rate).toBeCloseTo(take.onsets[7].time + 2, 4)
    expect(take.audio.startFrame).toBeLessThan(Math.round(0.1 * rate))
    expect(take.audio.samples[Math.round(0.1 * rate) - take.audio.startFrame]).toBe(26000 / 32768)
    const source = Float32Array.from(frames.get(rate)!.flatMap(frame => frame.pcm!.samples))
    expect(take.audio.samples).toEqual(source.slice(take.audio.startFrame, take.audio.startFrame + take.audio.samples.length))
    expect(result.current.reviewBarCount).toBe(3)
    expect(result.current.reviewBar?.waveform.hits).toHaveLength(4)
    await act(() => result.current.nextBar())
    expect(result.current.reviewBarIndex).toBe(1)
    expect(result.current.reviewBar?.waveform.hits).toHaveLength(4)
    await act(() => result.current.previousBar())
    expect(result.current.reviewBarIndex).toBe(0)
  })

  it('rearms Auto, replaces the unsaved take, and releases capture on review', async () => {
    const { result } = renderHook(() => usePractice(120, 'auto'))
    await act(() => result.current.listen('auto'))
    const callback = bridge.callbacks.get('audioFrame')!
    await act(async () => { for (const frame of frames.get(48000)!.filter(frame => frame.time < 6)) callback(frame) })
    const first = result.current.recordedTake!
    expect(first.onsets).toHaveLength(8)
    expect(result.current).toMatchObject({ source: 'microphone', captureMode: 'auto' })
    await act(async () => { for (const frame of frames.get(48000)!.filter(frame => frame.time >= 6)) callback(frame) })
    expect(result.current.recordedTake).not.toBe(first)
    expect(result.current.recordedTake?.origin).toBeCloseTo(6.4, 2)
    expect(result.current.recordedTake?.onsets).toHaveLength(1)
    await act(() => result.current.previousBar())
    expect(result.current).toMatchObject({ source: 'off', captureMode: 'single' })
    expect(bridge.stop).toHaveBeenCalledOnce()
  })

  it.each(['gap', 'rate', 'background'])('preserves interrupted native take on %s and ignores later frames', async interruption => {
    const { result } = renderHook(() => usePractice(120, 'auto'))
    await act(() => result.current.listen('auto'))
    const callback = bridge.callbacks.get('audioFrame')!
    const all = frames.get(48000)!
    const boundary = all.findIndex(frame => frame.time >= 3)
    await act(async () => { for (const frame of all.slice(0, boundary)) callback(frame) })
    await act(async () => {
      if (interruption === 'background') {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
        document.dispatchEvent(new Event('visibilitychange'))
      } else {
        const frame = all[boundary]
        callback({ ...frame, ...(interruption === 'rate' ? { sampleRate: 44100 } : { pcm: { ...frame.pcm, startFrame: frame.pcm!.startFrame + 1 } }) })
      }
    })
    const take = result.current.recordedTake!
    expect(take.endReason).toBe('interrupted')
    expect(take.onsets).toHaveLength(6)
    expect(result.current.source).toBe('off')
    await act(async () => { for (const frame of all.slice(boundary)) callback(frame) })
    expect(result.current.recordedTake).toBe(take)
  })
})
