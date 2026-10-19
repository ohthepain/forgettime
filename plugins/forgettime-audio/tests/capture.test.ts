// @vitest-environment jsdom
import { DEFAULT_DETECTOR_SETTINGS } from '../../../src/audio/detector-contract'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createAudioCapture } from '../../../src/audio/capture'

const mocks = vi.hoisted(() => ({
  native: true,
  available: true,
  start: vi.fn(),
  stop: vi.fn(),
  acknowledgeFrame: vi.fn(),
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
  acknowledgeFrame: mocks.acknowledgeFrame,
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
  mocks.start.mockReset().mockResolvedValue({ sessionId: 'ios-1', sampleRate: 48000, timestampQuality: 'sample-clock' })
  mocks.stop.mockReset().mockResolvedValue(undefined)
  mocks.acknowledgeFrame.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function webAudio(settings: MediaTrackSettings = {}, latency = { input: 0, base: 0, output: 0 }) {
  mocks.native = false
  const track = {
    stop: vi.fn(),
  acknowledgeFrame: vi.fn(), muted: false, label: 'Mac microphone',
    getSettings: () => ({ deviceId: 'mac', latency: latency.input, ...settings }),
    onended: null as null | (() => void), onmute: null as null | (() => void), onunmute: null as null | (() => void),
  }
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] }
  const getUserMedia = vi.fn().mockResolvedValue(stream)
  const close = vi.fn().mockResolvedValue(undefined)
  const port = { onmessage: null as null | ((event: { data: unknown }) => void), close: vi.fn(), postMessage: vi.fn() }
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('AudioContext', class {
    state = 'running'
    sampleRate = 48000
    currentTime = 0
    baseLatency = latency.base
    outputLatency = latency.output
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
  return { track, getUserMedia, close, emit, samples, port }
}

describe('browser capture recovery', () => {
  it('applies browser controls to subsequent source PCM without a capture restart', async () => {
    const web = webAudio()
    const frames: import('../../../src/audio/capture').CaptureFrame[] = []
    const capture = createAudioCapture({ onFrame: frame => frames.push(frame) })
    await capture.start()
    const samples = new Float32Array(24000)
    for (let i = 0; i < 256; i++) samples[4800 + i] = (i % 2 ? -0.05 : 0.05) * Math.exp(-i / 100)
    web.emit({ type: 'samples', startFrame: 0, sampleRate: 48000, samples })
    expect(frames.at(-1)!.onsets).toHaveLength(1)
    capture.setDetectorSettings!({ ...DEFAULT_DETECTOR_SETTINGS, minimumRms: 0.1 })
    web.emit({ type: 'samples', startFrame: 24000, sampleRate: 48000, samples })
    expect(frames.at(-1)!.onsets).toEqual([])
    expect(frames.at(-1)!.diagnostics!.candidates.some(candidate => candidate.reasons.includes('level'))).toBe(true)
    expect(web.getUserMedia).toHaveBeenCalledOnce()
    await capture.stop()
  })

  it('corrects metronome output for reported device latency while keeping capture timestamps untouched', async () => {
    const web = webAudio({}, { input: 0.1, base: 0.01, output: 0.14 })
    const onFrame = vi.fn()
    const capture = createAudioCapture({ onFrame })
    const info = await capture.start()
    expect(info.latency?.correctionSeconds).toBe(0.25)
    web.samples(48000)
    const plan = { origin: 1, bpm: 120, fromBeat: 1, untilTime: 1.35, stopTime: 3 }
    capture.setMetronome(plan)
    expect(web.port.postMessage).toHaveBeenLastCalledWith({ type: 'metronome', plan: { ...plan, origin: 0.75 } })
    expect(onFrame.mock.calls[0][0].time).toBeCloseTo(49024 / 48000)
    expect(onFrame.mock.calls[0][0].waveform[0].time).toBe(1)
    capture.setMetronome(null)
    expect(web.port.postMessage).toHaveBeenLastCalledWith({ type: 'metronome', plan: null })
    await capture.stop()
  })
  it('delivers actual signed PCM peaks with capture timestamps for the waveform, independently of onset detection', async () => {
    const web = webAudio()
    const onFrame = vi.fn()
    const capture = createAudioCapture({ onFrame })
    await capture.start()
    const samples = new Float32Array(1024)
    samples[511] = 0.9
    samples[650] = -0.7
    web.emit({ type: 'samples', startFrame: 48000, sampleRate: 48000, samples })
    const frame = onFrame.mock.calls[0][0]
    expect(frame.pcm).toEqual({ startFrame: 48000, samples })
    expect(frame.onsets).toEqual([]) // Still in detector startup; the audio is nevertheless visible.
    expect(frame.waveform).toHaveLength(10)
    expect(frame.waveform[5]).toMatchObject({ time: 1.01, duration: 0.002, min: 0, max: expect.closeTo(0.9) })
    expect(frame.waveform[6]).toMatchObject({ time: 1.012, min: expect.closeTo(-0.7), max: 0 })
    await capture.stop()
  })

  it.each([true, false, undefined])('reports applied processing settings (%s) instead of assuming our request was honored', async autoGainControl => {
    webAudio({ autoGainControl })
    const capture = createAudioCapture({ onFrame: vi.fn() })
    const info = await capture.start()
    expect(info.processing?.autoGainControl).toBe(autoGainControl)
    expect(info.processing?.noiseSuppression).toBeUndefined()
    await capture.stop()
  })

  it('requests the selected input and returns the actual track identity', async () => {
    const web = webAudio()
    const capture = createAudioCapture({ onFrame: vi.fn() }, { deviceId: 'mac' })
    await expect(capture.start()).resolves.toMatchObject({ inputLabel: 'Mac microphone', deviceId: 'mac' })
    expect(web.getUserMedia).toHaveBeenCalledWith({ audio: {
      deviceId: { exact: 'mac' }, channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      latency: { ideal: 0 },
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
  it('waits for native session identity and discards queued prior-session audio without losing opening PCM', async () => {
    let resolve!: (info: { sessionId: string; sampleRate: number; timestampQuality: string }) => void
    mocks.start.mockImplementation(() => new Promise(done => { resolve = done }))
    const onFrame = vi.fn()
    const capture = createAudioCapture({ onFrame })
    const starting = capture.start()
    await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledOnce())
    const callback = mocks.callbacks.get('audioFrame')!
    const frame = { sessionId: 'prior', time: 0, sampleRate: 48000, pcm: { startFrame: 0, samples: [0, 1.5, -1.25] },
      onsets: [], level: 1, timestampQuality: 'sample-clock' }
    mocks.callbacks.get('captureError')!({ sessionId: 'prior', message: 'old error' })
    mocks.callbacks.get('captureStopped')!({ sessionId: 'prior', reason: 'audio-interrupted' })
    callback(frame)
    callback({ ...frame, sessionId: 'ios-1' })
    expect(onFrame).not.toHaveBeenCalled()
    resolve({ sessionId: 'ios-1', sampleRate: 48000, timestampQuality: 'sample-clock' })
    await starting
    expect(onFrame).toHaveBeenCalledOnce()
    expect(onFrame.mock.calls[0][0].pcm.samples).toEqual(new Float32Array([0, 1.5, -1.25]))
    mocks.callbacks.get('captureError')!({ sessionId: 'prior', message: 'old error' })
    mocks.callbacks.get('captureStopped')!({ sessionId: 'prior', reason: 'audio-interrupted' })
    callback({ ...frame, pcm: { startFrame: 3, samples: [0] } })
    expect(onFrame).toHaveBeenCalledOnce()
    await capture.stop()
  })

  it('retains native source PCM on its sample clock without replacing original detections', async () => {
    const onFrame = vi.fn()
    const capture = createAudioCapture({ onFrame })
    await capture.start()
    const samples = [0, 0.75, -0.5, 0.25]
    const onsets = [{ time: 0.001, strength: 0.8, confidence: 0.9 }]
    mocks.callbacks.get('audioFrame')!({ sessionId: 'ios-1', time: 0.002, sampleRate: 48000,
      pcm: { startFrame: 96, samples }, onsets, level: 0.5, timestampQuality: 'hardware' })
    expect(onFrame.mock.calls[0][0]).toMatchObject({ source: 'native', onsets,
      pcm: { startFrame: 96, samples: new Float32Array(samples) } })
    expect(onFrame.mock.calls[0][0].pcm.samples).toBeInstanceOf(Float32Array)
    expect(mocks.acknowledgeFrame).toHaveBeenCalledWith({ sessionId: 'ios-1', endFrame: 100 })
    await capture.stop()
  })

  it.each(['missing PCM', 'gap', 'rate change', 'invalid samples', 'oversized packet'])('stops native retention on %s without delivering fabricated audio', async problem => {
    const onFrame = vi.fn()
    const onError = vi.fn()
    const capture = createAudioCapture({ onFrame, onError })
    await capture.start()
    const callback = mocks.callbacks.get('audioFrame')!
    const first = { sessionId: 'ios-1', time: 0, sampleRate: 48000,
      pcm: { startFrame: 0, samples: [0, 0.75, -0.5, 0.25] }, onsets: [], level: 0.5, timestampQuality: 'sample-clock' }
    callback(first)
    const next = { ...first, pcm: { startFrame: 4, samples: [0, 0, 0, 0] } }
    if (problem === 'missing PCM') delete (next as { pcm?: unknown }).pcm
    if (problem === 'gap') next.pcm.startFrame = 8
    if (problem === 'rate change') next.sampleRate = 44100
    if (problem === 'invalid samples') next.pcm.samples[0] = NaN
    if (problem === 'oversized packet') next.pcm.samples = Array(16385).fill(0)
    callback(next)
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce())
    expect(onFrame).toHaveBeenCalledOnce()
    expect(mocks.stop).toHaveBeenCalledOnce()
    callback(first)
    expect(onFrame).toHaveBeenCalledOnce()
  })

  it('preserves captured times and supplies clocks even when there are no hits', async () => {
    const onFrame = vi.fn()
    const capture = createAudioCapture({ onFrame })
    await capture.start()
    const callback = mocks.callbacks.get('audioFrame')!
    callback({ sessionId: 'ios-1', pcm: { startFrame: 0, samples: [0] }, time: 2.25, onsets: [{ time: 2.125, strength: 0.8, confidence: 0.9 }], sampleRate: 48000, level: 0.5, timestampQuality: 'hardware' })
    callback({ sessionId: 'ios-1', pcm: { startFrame: 1, samples: [0] }, time: 4.25, onsets: [], sampleRate: 48000, level: 0, timestampQuality: 'hardware' })
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

it('applies microphone gain before detection, level, waveform and retained PCM without moving source frames', async () => {
  const { port } = webAudio()
  const frames: import('../../../src/audio/capture').CaptureFrame[] = []
  const capture = createAudioCapture({ onFrame: frame => frames.push(frame) }, { inputGain: 2 })
  await capture.start()
  const samples = new Float32Array(4800)
  for (let i = 2400; i < 2528; i++) samples[i] = i % 2 ? -.01 : .01
  port.onmessage!({ data: { type: 'samples', samples, startFrame: 0, sampleRate: 48000 } })
  expect(frames[0].pcm?.samples[2400]).toBe(Math.fround(.02))
  expect(frames[0].onsets[0].time).toBe(.05)
  expect(frames[0].onsets[0].strength).toBeCloseTo(.02)
  expect(frames[0].waveform?.some(point => point.max === Math.fround(.02))).toBe(true)
  capture.setInputGain!(.5)
  port.onmessage!({ data: { type: 'samples', samples, startFrame: 4800, sampleRate: 48000 } })
  expect(frames[1].pcm?.startFrame).toBe(4800)
  expect(frames[1].pcm?.samples[2400]).toBe(Math.fround(.005))
  expect(frames[0].pcm?.samples[2400]).toBe(Math.fround(.02))
  expect(samples[2400]).toBe(Math.fround(.01))
  await capture.stop()
})

it('refuses to silently ignore microphone gain on an older native plugin', async () => {
  const capture = createAudioCapture({ onFrame: vi.fn() }, { inputGain: 2 })
  await expect(capture.start()).rejects.toThrow('Microphone gain requires an updated native audio plugin')
  expect(mocks.stop).toHaveBeenCalled()
})
it('passes initial gain to a native plugin that advertises support', async () => {
  mocks.start.mockResolvedValue({ sessionId: 'gain-session', sampleRate: 48000, timestampQuality: 'sample-clock', inputGainSupported: true })
  const capture = createAudioCapture({ onFrame: vi.fn() }, { inputGain: 1.05 })
  await capture.start()
  expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({ inputGain: 1.05 }))
  await capture.stop()
})

it.each(['current', 'mel'] as const)('runs the selected %s profile on both browser and native PCM, ignoring native default hits', async family => {
  const { baselineParameters } = await import('../../../src/audio/training-optimizer');
  const profile = baselineParameters(family);
  const rate = 48000, pcm = new Float32Array(rate);
  for (const t of [0.2, 0.5, 0.8]) for (let i = 0; i < 2000; i++) pcm[Math.round(t * rate) + i] += 0.6 * Math.exp(-i / 576) * Math.sin(i * 2.73);
  const web = webAudio();
  const browserFrames: import('../../../src/audio/capture').CaptureFrame[] = [];
  const browser = createAudioCapture({ onFrame: frame => browserFrames.push(frame) }, { profile });
  await browser.start();
  for (let i = 0; i < pcm.length; i += 997) web.emit({ type: 'samples', samples: pcm.subarray(i, i + 997), startFrame: i, sampleRate: rate });
  await browser.stop();
  mocks.native = true;
  const nativeFrames: import('../../../src/audio/capture').CaptureFrame[] = [];
  const native = createAudioCapture({ onFrame: frame => nativeFrames.push(frame) }, { profile });
  const info = await native.start();
  expect(info.analysis?.implementation).toBe(`selected-${family}`);
  for (let i = 0; i < pcm.length; i += 997) mocks.callbacks.get('audioFrame')!({ sessionId: 'ios-1', time: 900, sampleRate: rate, level: 0, onsets: [{ time: 899, strength: 1, confidence: 1 }], pcm: { startFrame: i, samples: Array.from(pcm.subarray(i, i + 997)) } });
  expect(nativeFrames.flatMap(frame => frame.onsets)).toEqual(browserFrames.flatMap(frame => frame.onsets));
  expect(nativeFrames.flatMap(frame => frame.onsets).length).toBeGreaterThan(0);
  expect(nativeFrames.map(frame => frame.time)).toEqual(browserFrames.map(frame => frame.time));
  expect(nativeFrames[0].pcm?.samples).toEqual(pcm.subarray(0, 997));
  expect(nativeFrames[0].analysis?.implementation).toBe(`selected-${family}`);
  await native.stop();
});
