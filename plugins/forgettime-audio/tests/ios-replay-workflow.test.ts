// @vitest-environment jsdom
/** Real Swift detector/replay through shared presentation; only the audio-output edge is substituted. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { NativeBarReplay } from '../../../src/audio/native-replay'
import { DEFAULT_DETECTOR_SETTINGS } from '../../../src/audio/detector-contract'
import type { RecordedTake } from '../../../src/audio/recorded-take'
import type { ReplayState } from '../../../src/audio/replay'
const bridge = vi.hoisted(() => ({ start: vi.fn(), read: vi.fn(), stop: vi.fn(), capture: vi.fn(), pollSeconds: 0.25 }))
vi.mock('forgettime-audio', () => ({ ForgettimeAudio: { startReplay: bridge.start, readReplay: bridge.read, stopReplay: bridge.stop,
  setReplayMetronome: async () => {}, start: bridge.capture } }))

describe.skipIf(!process.env.FORGETTIME_NATIVE_HOST_TESTS)('Swift replay PCM through shared practice presentation', () => {
  let directory: string
  let binary: string
  let tick: FrameRequestCallback
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'forgettime-swift-replay-workflow-'))
    binary = join(directory, 'replay')
    execFileSync('swiftc', ['-module-cache-path', join(directory, 'cache'),
      ...['DrumOnsetDetector', 'NativeReplayStream'].map(name => resolve(`plugins/forgettime-audio/ios/Sources/ForgettimeAudioPlugin/${name}.swift`)),
      resolve('plugins/forgettime-audio/tests/ios-replay/main.swift'), '-o', binary])
  }, 20000)
  afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }) })
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { tick = callback; return 1 })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    bridge.pollSeconds = 0.25
    bridge.capture.mockReset()
    bridge.stop.mockReset().mockResolvedValue(undefined)
    bridge.start.mockReset().mockImplementation(async ({ sessionId, sampleRate, samples, detectorSettings, frequencyBalance = 0 }) => {
      const pcm = Float32Array.from(samples as number[])
      const path = join(directory, 'source.f32')
      writeFileSync(path, Buffer.from(pcm.buffer))
      const polls = Array.from({ length: Math.ceil(4 / bridge.pollSeconds) }, (_, i) => Math.min(sampleRate * 4, Math.round((i + 1) * sampleRate * bridge.pollSeconds)))
      const frames = execFileSync(binary, [path, String(sampleRate), JSON.stringify(detectorSettings), polls.join(','), String(frequencyBalance)],
        { encoding: 'utf8', maxBuffer: 8e6 }).trim().split('\n').map(line => JSON.parse(line))
      let index = 0
      bridge.read.mockImplementation(async () => ({ ...frames[index++], sessionId, status: 'playing', clockQuality: 'estimated' }))
      return { sessionId, sampleRate, frameCount: pcm.length, diagnosticsSupported: true, frequencyBalanceSupported: true }
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each([44100, 48000])('keeps a fixed grid and original results across native loops and a no-hit settings restart at %s Hz', async sampleRate => {
    const samples = new Float32Array(sampleRate * 2)
    for (const onset of [0.1, 0.6, 1.1, 1.6]) {
      for (let i = 0; i < sampleRate * 0.015; i++) samples[Math.round(onset * sampleRate) + i] = 0.05 * Math.sin(i * 1.7) * Math.exp(-i / (sampleRate * 0.003))
    }
    const take: RecordedTake = { source: 'native', continuity: 1, origin: 0.000001,
      audio: { startFrame: 0, sampleRate, samples }, settings: { bpm: 120, mode: 'straight', startSensitivity: 50, detector: { ...DEFAULT_DETECTOR_SETTINGS } },
      onsets: [{ time: 0.1, strength: 0.05, confidence: 0.8 }], results: [], endReason: 'stopped' }
    const original = JSON.stringify(take)
    const error = vi.fn()
    let state: ReplayState | undefined
    const normal = new NativeBarReplay(take, 0, value => { state = value }, error)
    await normal.start()
    for (let i = 0; i < 16; i++) await tick(1e12) // Deliberately unrelated callback arrival time.
    expect(error).not.toHaveBeenCalled()
    expect(state).toMatchObject({ time: 4, iteration: 2, snapshot: { status: 'playing', phaseOrigin: 0.000001 } })
    expect(state!.onsets.length).toBeGreaterThan(0)
    expect(state!.candidates.some(candidate => candidate.accepted)).toBe(true)
    const scores = state!.results.map(({ id: _id, ...result }) => result)
    await normal.stop()
    bridge.pollSeconds = 2
    const delayed = new NativeBarReplay(take, 0, value => { state = value }, error)
    await delayed.start()
    for (let i = 0; i < 2; i++) await tick(99)
    expect(error).not.toHaveBeenCalled()
    expect(state!.results.map(({ id: _id, ...result }) => result)).toEqual(scores)
    await delayed.stop()
    bridge.pollSeconds = 0.25
    const quiet = new NativeBarReplay(take, 0, value => { state = value }, error,
      { ...DEFAULT_DETECTOR_SETTINGS, minimumRms: 0.1, contrastRatio: 4 })
    await quiet.start()
    for (let i = 0; i < 16; i++) await tick(0)
    expect(error).not.toHaveBeenCalled()
    expect(state).toMatchObject({ time: 4, iteration: 2, onsets: [], snapshot: { status: 'playing', phaseOrigin: 0.000001 } })
    expect(state!.candidates.some(candidate => candidate.reasons.includes('level'))).toBe(true)
    expect(JSON.stringify(take)).toEqual(original)
    expect(bridge.capture).not.toHaveBeenCalled()
    await quiet.stop()
  })
  it.each([50, 100])('runs native spectral balance %i with immutable originals and a fixed reference', async balance => {
    const rate = 48000, samples = new Float32Array(rate * 2)
    for (const t of [.1, .6, 1.1, 1.6]) for (let i = 0; i < 512; i++) samples[Math.round(t * rate) + i] = .2 * Math.sin(i * .7) * Math.exp(-i / 100)
    const take: RecordedTake = { source: 'native', continuity: 1, origin: .000001, audio: { startFrame: 0, sampleRate: rate, samples }, settings: { bpm: 120, mode: 'straight', startSensitivity: 50 }, onsets: [], results: [], endReason: 'stopped' }
    let state!: ReplayState
    const error = vi.fn()
    const replay = new NativeBarReplay(take, 0, value => { state = value }, error, DEFAULT_DETECTOR_SETTINGS, balance)
    await replay.start()
    for (let i = 0; i < 16; i++) await tick(9999)
    expect(error).not.toHaveBeenCalled()
    expect(state.frequencyBalance).toBe(balance)
    expect(state.snapshot.phaseOrigin).toBe(.000001)
    expect(state.candidates.some(candidate => candidate.evidence?.frequencyBalance === balance)).toBe(true)
    expect(take.onsets).toEqual([])
    expect(bridge.capture).not.toHaveBeenCalled()
    await replay.stop()
  })

})
