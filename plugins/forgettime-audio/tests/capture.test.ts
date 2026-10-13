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

function webAudio() {
  mocks.native = false
  const track = {
    stop: vi.fn(), muted: false, label: 'Mac microphone',
    getSettings: () => ({ deviceId: 'mac' }),
    onended: null as null | (() => void), onmute: null as null | (() => void), onunmute: null as null | (() => void),
  }
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] }
  const getUserMedia = vi.fn().mockResolvedValue(stream)
  const close = vi.fn().mockResolvedValue(undefined)
  const port = { onmessage: null as null | ((event: { data: unknown }) => void), close: vi.fn() }
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('AudioContext', class {
    state = 'running'
    sampleRate = 48000
    resume = vi.fn().mockResolvedValue(undefined)
    close = close
    audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) }
    createMediaStreamSource = () => ({ connect: vi.fn(), disconnect: vi.fn() })
  })
  vi.stubGlobal('AudioWorkletNode', class {
    port = port
    connect = vi.fn()
    disconnect = vi.fn()
  })
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  const emit = (data: unknown) => port.onmessage?.({ data })
  const samples = (startFrame: number) => emit({ type: 'samples', startFrame, sampleRate: 48000, samples: new Float32Array(1024) })
  return { track, getUserMedia, close, emit, samples }
}

describe('browser capture recovery', () => {
  it('requests the selected input and returns the actual track identity', async () => {
    const web = webAudio()
    const capture = createAudioCapture({ onFrame: vi.fn() }, { deviceId: 'mac' })
    await expect(capture.start()).resolves.toMatchObject({ inputLabel: 'Mac microphone', deviceId: 'mac' })
    expect(web.getUserMedia).toHaveBeenCalledWith({ audio: {
      deviceId: { exact: 'mac' }, channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false,
    } })
    await capture.stop()
  })

  it('resets the reference before resuming sample-clock frames without closing capture', async () => {
    const web = webAudio()
    const events: (number | 'reset')[] = []
    const onError = vi.fn()
    const capture = createAudioCapture({ onFrame: frame => events.push(frame.time), onDiscontinuity: () => events.push('reset'), onError })
    await capture.start()
    web.samples(48000)
    web.emit({ type: 'gap' })
    web.samples(96000)
    expect(events).toEqual([expect.closeTo(49024 / 48000, 10), 'reset', expect.closeTo(97024 / 48000, 10)])
    expect(web.close).not.toHaveBeenCalled()
    expect(web.track.stop).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    await capture.stop()
  })

  it('handles a timestamp discontinuity even if the worklet gap message is missing', async () => {
    const web = webAudio()
    const reset = vi.fn()
    const onFrame = vi.fn()
    const capture = createAudioCapture({ onFrame, onDiscontinuity: reset })
    await capture.start()
    web.samples(48000)
    web.samples(49024)
    expect(reset).not.toHaveBeenCalled()
    web.samples(240000)
    expect(reset).toHaveBeenCalledOnce()
    expect(onFrame.mock.calls.at(-1)?.[0].time).toBeCloseTo(241024 / 48000, 10)
    await capture.stop()
  })

  it('does not treat a muted track as musical silence and recovers without reopening it', async () => {
    const web = webAudio()
    const onFrame = vi.fn()
    const reset = vi.fn()
    const capture = createAudioCapture({ onFrame, onDiscontinuity: reset })
    await capture.start()
    web.samples(48000)
    web.track.muted = true
    web.track.onmute?.()
    web.samples(49024)
    web.emit({ type: 'gap' })
    expect(onFrame).toHaveBeenCalledOnce()
    expect(reset).toHaveBeenCalledOnce()
    web.track.muted = false
    web.track.onunmute?.()
    web.samples(96000)
    expect(reset).toHaveBeenCalledOnce()
    expect(onFrame).toHaveBeenCalledTimes(2)
    expect(web.getUserMedia).toHaveBeenCalledOnce()
    await capture.stop()
  })

  it('releases a disconnected input with an actionable error', async () => {
    const web = webAudio()
    const onError = vi.fn()
    const capture = createAudioCapture({ onFrame: vi.fn(), onError })
    await capture.start()
    web.track.onended?.()
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('microphone disconnected') })))
    expect(web.track.stop).toHaveBeenCalledOnce()
    expect(web.close).toHaveBeenCalledOnce()
  })
})

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
