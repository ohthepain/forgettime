// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { NativeBarReplay } from '../../../src/audio/native-replay'
import type { ReplayState } from '../../../src/audio/replay'
import { DEFAULT_DETECTOR_SETTINGS, type DetectorSettings } from '../../../src/audio/detector-contract'
import { OnsetDetector } from '../../../src/audio/onset-detector'
const hardware = vi.hoisted(() => ({ start: vi.fn(), read: vi.fn(), stop: vi.fn(), plan: vi.fn() }))
vi.mock('forgettime-audio', () => ({ ForgettimeAudio: { startReplay: hardware.start, readReplay: hardware.read, stopReplay: hardware.stop, setReplayMetronome: hardware.plan } }))
describe.skipIf(!process.env.FORGETTIME_NATIVE_HOST_TESTS)('real Java loop source through native presentation', () => {
  let directory: string
  const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin') : ''
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'forgettime-android-replay-'))
    execFileSync(join(java, 'javac'), ['-d', directory, ...['DrumOnsetDetector', 'NativeReplayStream', 'ReplayOutputClock'].map(name => resolve(`plugins/forgettime-audio/android/src/main/java/app/forgettime/audio/${name}.java`)), resolve('plugins/forgettime-audio/tests/AndroidReplayRunner.java')])
    expect(execFileSync(join(java, 'java'), ['-cp', directory, 'AndroidReplayRunner'], { encoding: 'utf8' })).toContain('contracts passed')
  })
  afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }) })
  afterEach(() => vi.unstubAllGlobals())
  function fixture(rate: number) {
    const samples = new Float32Array(rate * 2)
    for (const time of [0.1, 0.35, 0.62, 0.82, 1.12, 1.35, 1.64, 1.86]) for (let i = 0; i < 256; i++) samples[Math.round(time * rate) + i] = (i % 2 ? -0.2 : 0.2) * Math.exp(-i / 100)
    return samples
  }
  function frames(samples: Float32Array, rate: number, step: number, settings = DEFAULT_DETECTOR_SETTINGS) {
    const path = join(directory, 'source.f32'); writeFileSync(path, Buffer.from(samples.buffer))
    return execFileSync(join(java, 'java'), ['-cp', directory, 'AndroidReplayRunner', path, String(rate), String(settings.minimumRms), String(settings.contrastRatio), String(settings.minSeparationMs), String(settings.recoverySeconds), String(Math.round(step * rate)), '3'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim().split('\n').map(line => JSON.parse(line))
  }
  async function present(samples: Float32Array, rate: number, packets: ReturnType<typeof frames>, settings = DEFAULT_DETECTOR_SETTINGS) {
    let tick!: FrameRequestCallback, latest!: ReplayState, sessionId = ''
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { tick = callback; return 1 }); vi.stubGlobal('cancelAnimationFrame', vi.fn())
    hardware.start.mockImplementation(async request => { sessionId = request.sessionId; return { sessionId, sampleRate: rate, frameCount: samples.length, diagnosticsSupported: true } })
    hardware.stop.mockResolvedValue(undefined); hardware.plan.mockResolvedValue(undefined)
    hardware.read.mockImplementation(async () => ({ ...packets.shift(), sessionId }))
    const original = { audio: { samples, sampleRate: rate, startFrame: 0 }, origin: 0, source: 'native' as const, continuity: 0,
      settings: { bpm: 120, mode: 'auto' as const, startSensitivity: 50 }, onsets: [], results: [], endReason: 'stopped' as const }
    const replay = new NativeBarReplay(original, 0, state => { latest = state }, message => { throw new Error(message) }, settings)
    await replay.start()
    while (packets.length) await tick(1e10)
    await replay.stop()
    expect(original.onsets).toEqual([])
    return latest
  }
  it.each([44100, 48000])('keeps timing interpretation identical under frequent or delayed native reads at %i Hz', async rate => {
    const samples = fixture(rate)
    const fast = await present(samples, rate, frames(samples, rate, 0.017))
    const delayed = await present(samples, rate, frames(samples, rate, 1.5))
    const results = (state: ReplayState) => state.results.map(({ id, ...value }) => value)
    expect(delayed.onsets).toEqual(fast.onsets)
    expect(results(delayed)).toEqual(results(fast))
    expect(delayed.snapshot.phaseOrigin).toBe(0)
  })
  it.each([44100, 48000])('matches native candidate decisions and control endpoints across loop joins at %i Hz', rate => {
    const window = Math.max(32, Math.round(rate * 0.002667))
    const amplitudes = [0.04, ...Array(20).fill(0), 0.003, ...Array(20).fill(0), 0.04, 0.045, 0.1, ...Array(20).fill(0)]
    const samples = Float32Array.from(amplitudes.flatMap(amplitude => Array.from({ length: window }, (_, i) => (i % 2 ? -1 : 1) * amplitude)))
    const settings: DetectorSettings[] = [DEFAULT_DETECTOR_SETTINGS,
      ...[0.001, 0.1].map(minimumRms => ({ ...DEFAULT_DETECTOR_SETTINGS, minimumRms })),
      ...[1.1, 4].map(contrastRatio => ({ ...DEFAULT_DETECTOR_SETTINGS, contrastRatio })),
      ...[8, 100].map(minSeparationMs => ({ ...DEFAULT_DETECTOR_SETTINGS, minSeparationMs })),
      ...[0.25, 12].map(recoverySeconds => ({ ...DEFAULT_DETECTOR_SETTINGS, recoverySeconds }))]
    function compare(actual: any, expected: any) {
      if (typeof expected === 'number') { expect(actual).toBeCloseTo(expected, 9); return }
      if (Array.isArray(expected)) { expect(actual).toHaveLength(expected.length); expected.forEach((item, i) => compare(actual[i], item)); return }
      if (expected && typeof expected === 'object') { expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort()); for (const key of Object.keys(expected)) compare(actual[key], expected[key]); return }
      expect(actual).toEqual(expected)
    }
    for (const options of settings) {
      const native = frames(samples, rate, 0.017, options)
      const detector = new OnsetDetector(options)
      const pcm = Float32Array.from({ length: samples.length * 3 }, (_, i) => samples[i % samples.length])
      const onsets = [], candidates = []
      for (let cursor = 0; cursor < pcm.length; cursor += 127) {
        onsets.push(...detector.process(pcm.subarray(cursor, cursor + 127), cursor / rate, rate))
        candidates.push(...detector.drainDiagnostics().candidates)
      }
      compare(native.flatMap(frame => frame.onsets), onsets)
      compare(native.flatMap(frame => frame.diagnostics.candidates), candidates)
      if (options === DEFAULT_DETECTOR_SETTINGS) {
        expect(new Set(candidates.flatMap(candidate => candidate.reasons))).toEqual(new Set(['warming-up', 'level', 'rise', 'contrast', 'separation', 'rearming']))
      }
    }
  })
  it('starts a fresh native run after tuning removes every attack without moving the source grid', async () => {
    const rate = 48000, samples = fixture(rate)
    const normal = await present(samples, rate, frames(samples, rate, 0.25))
    const strict = { ...DEFAULT_DETECTOR_SETTINGS, minimumRms: 0.1, contrastRatio: 4 }
    const tuned = await present(samples, rate, frames(samples, rate, 0.25, strict), strict)
    const restarted = await present(samples, rate, frames(samples, rate, 0.25))
    expect(normal.onsets.length).toBeGreaterThan(0)
    expect(tuned.onsets).toEqual([])
    expect(tuned.candidates.some(candidate => candidate.reasons.includes('contrast'))).toBe(true)
    expect(tuned.snapshot).toMatchObject({ status: 'playing', phaseOrigin: 0 })
    expect(restarted.onsets).toEqual(normal.onsets)
    expect(restarted.run).not.toBe(normal.run)
  })

})
