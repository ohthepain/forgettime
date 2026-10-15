// @vitest-environment jsdom
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { webcrypto } from 'node:crypto'
import { act, cleanup, renderHook } from '@testing-library/react'
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { createNativeBarFiles } from '../../../src/audio/native-files'
import { usePractice } from '../../../src/audio/use-practice'
import { createBarFiles, restoreBarFiles } from '../../../src/audio/bar-files'
import { DEFAULT_DETECTOR_SETTINGS } from '../../../src/audio/detector-contract'
const edge = vi.hoisted(() => ({ invoke: (_method: string, _args?: unknown): Promise<any> => Promise.reject(new Error('Not started')), capture: vi.fn() }))
vi.mock('forgettime-audio', () => ({ ForgettimeAudio: new Proxy({}, { get: (_, name) => (args: unknown) => edge.invoke(String(name), args) }) }))
vi.mock('../../../src/audio/capture', () => ({ createAudioCapture: edge.capture }))
const enabled = process.env.FORGETTIME_NATIVE_HOST_TESTS === '1'
describe.skipIf(!enabled)('Java files through shared native adapter and practice', () => {
  let directory: string, process: ChildProcessWithoutNullStreams
  const pending: { resolve: (v: any) => void; reject: (e: Error) => void }[] = []
  let pickPaths: string[] = []
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'forgettime-android-files-workflow-'))
    const java = globalThis.process.env.JAVA_HOME ? join(globalThis.process.env.JAVA_HOME, 'bin') : ''
    const source = 'plugins/forgettime-audio/android/src/main/java/app/forgettime/audio/'
    const build = spawnSync(join(java, 'javac'), ['-d', directory, ...['NativeBarStore', 'DrumOnsetDetector'].map(name => `${source}${name}.java`), 'plugins/forgettime-audio/tests/AndroidFilesBridgeRunner.java'], { encoding: 'utf8' })
    if (build.status !== 0) throw new Error(build.stderr)
    process = spawn(join(java, 'java'), ['-cp', directory, 'AndroidFilesBridgeRunner', join(directory, 'store')])
    createInterface({ input: process.stdout }).on('line', line => { const reply = JSON.parse(line), waiter = pending.shift()!; reply.error ? waiter.reject(new Error(reply.error)) : waiter.resolve(reply.result) })
    edge.invoke = (method, args: any = {}) => new Promise((resolve, reject) => {
      const encode = (text: string) => Buffer.from(text).toString('base64')
      const fields = method === 'beginBarSave' ? [args.summary.id, encode(args.summary.name), args.summary.createdAt, args.summary.bpm, args.summary.complete, args.summary.bytes, args.wavBytes, args.sidecarBytes]
        : method === 'appendFileChunk' ? [args.transferId, args.part, args.offset, args.data]
        : method === 'commitBarSave' || method === 'abortFileTransfer' ? [args.transferId]
        : method === 'readSavedBar' || method === 'exportSavedBar' ? [args.id]
        : method === 'readFileChunk' ? [args.handle, args.offset, args.length]
        : method === 'releaseFiles' ? args.handles
        : method === 'pickAudioFiles' ? pickPaths.map(encode)
        : method === 'analyzeFixture' ? [encode(args.path), args.sampleRate] : []
      pending.push({ resolve, reject }); process.stdin.write(`${[method, ...fields].join('\t')}\n`)
    })
    vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', vi.fn())
  }, 30000)
  afterEach(cleanup)
  afterAll(() => { process?.kill(); vi.unstubAllGlobals(); if (directory) rmSync(directory, { recursive: true, force: true }) })
  it.each([44100, 48000])('round-trips actual PCM, native provenance and fractional origin through durable restart and UI at %i Hz', async rate => {
    const samples = new Float32Array(7 * rate)
    for (let beat = 0; beat < 8; beat++) for (let i = 0; i < 256; i++) samples[Math.round((.103 + beat * 60 / 110) * rate) + i] = (i % 2 ? -.8 : .8) * Math.exp(-i / 100)
    const path = join(directory, `fixture-${rate}.f32`); writeFileSync(path, Buffer.from(samples.buffer))
    const { onsets, diagnostics } = await edge.invoke('analyzeFixture', { path, sampleRate: rate })
    const original = { source: 'native' as const, continuity: 0, audio: { samples, sampleRate: rate, startFrame: 0 }, origin: onsets[0].time, settings: { bpm: 110, mode: 'straight' as const, startSensitivity: 50, detector: DEFAULT_DETECTOR_SETTINGS }, onsets, results: [], diagnostics, analysis: { implementation: 'forgettime-java-onset', version: '1' }, endReason: 'stopped' as const }
    const pair = await createBarFiles(original, 1), expected = await restoreBarFiles(pair)
    const options = createNativeBarFiles(), id = `native-${rate}`
    await options.savedBars!.save({ id, name: 'Native bar', bpm: 110, createdAt: rate, complete: true, bytes: pair.wav.byteLength + Buffer.byteLength(pair.sidecar), ...pair })
    await edge.invoke('restart')
    const hook = renderHook(() => usePractice(90, 'auto', 50, undefined, options))
    await act(() => hook.result.current.openSavedBar(id))
    expect(hook.result.current.recordedTake!.audio.samples).toEqual(expected.audio.samples)
    expect(hook.result.current.recordedTake!.origin).toBe(expected.origin)
    expect(hook.result.current.recordedTake!.analysis).toEqual(original.analysis)
    expect(hook.result.current.recordedTake!.diagnostics).toEqual(expected.diagnostics)
    expect(hook.result.current).toMatchObject({ source: 'off', captureMode: 'single', reviewBarCount: 1 })
    await act(() => hook.result.current.configureDetector({ minimumRms: .1 }))
    expect(hook.result.current.recordedTake!.settings.detector!.minimumRms).toBe(.006)
    await act(() => hook.result.current.exportSavedPair(id))
    expect(hook.result.current.libraryNotice).toMatch(/cancelled.*retained/i)
    expect((await options.savedBars!.read(id)).wav).toEqual(pair.wav)
    expect(edge.capture).not.toHaveBeenCalled()
  })
  it('restores the independent browser golden pair through selected native copies and preserves it when import is cancelled', async () => {
    pickPaths = ['wav', 'forget'].map(ext => resolve(`tests/fixtures/bar-files/float32-partial.${ext}`))
    const options = createNativeBarFiles(), hook = renderHook(() => usePractice(110, 'straight', 50, undefined, options))
    await act(() => hook.result.current.chooseImportFiles())
    expect(hook.result.current.importState).toBeNull()
    expect(hook.result.current.recordedTake!.audio.samples).toEqual(Float32Array.of(-0, 1.25, -1.5, .125))
    pickPaths = []
    await act(() => hook.result.current.chooseImportFiles())
    expect(hook.result.current.recordedTake!.audio.samples).toEqual(Float32Array.of(-0, 1.25, -1.5, .125))
    expect(edge.capture).not.toHaveBeenCalled()
  })
})
