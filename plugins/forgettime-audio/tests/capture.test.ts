// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAudioCapture } from '../../../src/audio/capture'

const mocks = vi.hoisted(() => ({
  native: true,
  available: true,
  start: vi.fn(),
  stop: vi.fn(),
  callbacks: new Map<string, (event: unknown) => void>(),
  removed: [] as string[],
}))
vi.mock('@capacitor/core', () => ({ Capacitor: {
  isNativePlatform: () => mocks.native,
  isPluginAvailable: () => mocks.available,
} }))
vi.mock('forgettime-audio', () => ({ ForgettimeAudio: {
  start: mocks.start,
  stop: mocks.stop,
  addListener: async (name: string, callback: (event: unknown) => void) => {
    mocks.callbacks.set(name, callback)
    return { remove: async () => { mocks.removed.push(name); mocks.callbacks.delete(name) } }
  },
} }))

beforeEach(() => {
  mocks.native = true
  mocks.available = true
  mocks.callbacks.clear()
  mocks.removed = []
  mocks.start.mockReset().mockResolvedValue({ sampleRate: 48000, timestampQuality: 'sample-clock' })
  mocks.stop.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('capture lifecycle and clock contract', () => {
  it('preserves captured times and supplies clocks even when there are no hits', async () => {
    const onFrame = vi.fn()
    const capture = createAudioCapture({ onFrame })
    await capture.start()
    const callback = mocks.callbacks.get('audioFrame')!
    callback({ time: 2.25, onsets: [{ time: 2.125, strength: 0.8, confidence: 0.9 }], sampleRate: 48000, level: 0.5, timestampQuality: 'hardware' })
    callback({ time: 4.25, onsets: [], sampleRate: 48000, level: 0, timestampQuality: 'hardware' })
    expect(onFrame.mock.calls[0][0]).toMatchObject({ time: 2.25, onsets: [{ time: 2.125 }], source: 'native' })
    expect(onFrame.mock.calls[1][0]).toMatchObject({ time: 4.25, onsets: [] })
    await capture.stop()
    callback({ time: 5, onsets: [] })
    expect(onFrame).toHaveBeenCalledTimes(2)
    expect(mocks.removed).toHaveLength(3)
  })

  it('deduplicates concurrent starts and releases capture only once', async () => {
    const capture = createAudioCapture({ onFrame: vi.fn() })
    const first = capture.start()
    expect(capture.start()).toBe(first)
    await first
    await Promise.all([capture.stop(), capture.stop()])
    expect(mocks.start).toHaveBeenCalledTimes(1)
    expect(mocks.stop).toHaveBeenCalledTimes(1)
  })

  it('releases a native stream when startup finishes after cancellation', async () => {
    let resolveStart!: (value: { sampleRate: number; timestampQuality: string }) => void
    mocks.start.mockImplementation(() => new Promise((resolve) => { resolveStart = resolve }))
    const capture = createAudioCapture({ onFrame: vi.fn() })
    const starting = capture.start()
    const rejected = expect(starting).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledOnce())
    await capture.stop()
    resolveStart({ sampleRate: 48000, timestampQuality: 'sample-clock' })
    await rejected
    expect(mocks.stop).toHaveBeenCalledOnce()
    expect(mocks.callbacks.size).toBe(0)
  })

  it('stops on backgrounding and discards late bridge callbacks', async () => {
    const onFrame = vi.fn()
    const onStopped = vi.fn()
    const capture = createAudioCapture({ onFrame, onStopped })
    await capture.start()
    const callback = mocks.callbacks.get('audioFrame')!
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    callback({ time: 1, onsets: [] })
    await vi.waitFor(() => expect(onStopped).toHaveBeenCalledWith('background'))
    expect(onFrame).not.toHaveBeenCalled()
    expect(mocks.stop).toHaveBeenCalledOnce()
  })

  it('reports a missing native plugin instead of falling back to web capture', async () => {
    mocks.available = false
    const capture = createAudioCapture({ onFrame: vi.fn() })
    await expect(capture.start()).rejects.toThrow('missing the Forgettime audio plugin')
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('releases web microphone permission granted after the user has stopped', async () => {
    mocks.native = false
    let grant!: (stream: MediaStream) => void
    const trackStop = vi.fn()
    const close = vi.fn().mockResolvedValue(undefined)
    const getUserMedia = vi.fn(() => new Promise<MediaStream>((resolve) => { grant = resolve }))
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('AudioContext', class {
      state = 'running'
      resume = vi.fn().mockResolvedValue(undefined)
      close = close
      audioWorklet = { addModule: vi.fn() }
    })
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
    const capture = createAudioCapture({ onFrame: vi.fn() })
    const starting = capture.start()
    const rejected = expect(starting).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce())
    await capture.stop()
    grant({ getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream)
    await rejected
    expect(trackStop).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })
})
