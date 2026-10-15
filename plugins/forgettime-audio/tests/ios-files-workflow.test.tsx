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
describe.skipIf(!enabled)('Swift files through shared native adapter and practice', () => {
  let directory: string, process: ChildProcessWithoutNullStreams
  const pending: { resolve: (v: any) => void; reject: (e: Error) => void }[] = []
  let pickPaths: string[] = []
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'forgettime-ios-files-workflow-'))
    const source = 'plugins/forgettime-audio/ios/Sources/ForgettimeAudioPlugin/'
    const build = spawnSync('swiftc', ['-module-cache-path', join(directory, 'cache'), ...['NativeBarFiles', 'NativeAudioFileDecoder', 'DrumOnsetDetector'].map(name => `${source}${name}.swift`), 'plugins/forgettime-audio/tests/ios-files-bridge/main.swift', '-o', join(directory, 'bridge')], { encoding: 'utf8' })
    if (build.status !== 0) throw new Error(build.stderr)
    const codec = spawnSync('swiftc', ['-module-cache-path', join(directory, 'cache'), ...['NativeBarFiles', 'NativeAudioFileDecoder'].map(name => `${source}${name}.swift`), 'plugins/forgettime-audio/tests/ios-decode/main.swift', '-o', join(directory, 'codec')], { encoding: 'utf8' })
    if (codec.status !== 0) throw new Error(codec.stderr)
    const encoded = spawnSync(join(directory, 'codec'), [join(directory, 'encoded')], { encoding: 'utf8' })
    if (encoded.status !== 0) throw new Error(encoded.stderr)
    process = spawn(join(directory, 'bridge'), [join(directory, 'store')])
    createInterface({ input: process.stdout }).on('line', line => { const reply = JSON.parse(line), waiter = pending.shift()!; reply.error ? waiter.reject(new Error(reply.error)) : waiter.resolve(reply.result) })
    edge.invoke = (method, args) => new Promise((resolve, reject) => { pending.push({ resolve, reject }); process.stdin.write(`${JSON.stringify({ method, args: method === 'pickAudioFiles' ? { paths: pickPaths } : args })}\n`) })
    vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', vi.fn())
  }, 30000)
  afterEach(cleanup)
  afterAll(() => { process?.kill(); vi.unstubAllGlobals(); if (directory) rmSync(directory, { recursive: true, force: true }) })
  it.each([44100, 48000])('round-trips actual PCM, native provenance and fractional origin through durable restart and UI at %i Hz', async rate => {
    const samples = new Float32Array(7 * rate)
    for (let beat = 0; beat < 8; beat++) for (let i = 0; i < 256; i++) samples[Math.round((.103 + beat * 60 / 110) * rate) + i] = (i % 2 ? -.8 : .8) * Math.exp(-i / 100)
    const path = join(directory, `fixture-${rate}.f32`); writeFileSync(path, Buffer.from(samples.buffer))
    const { onsets, diagnostics } = await edge.invoke('analyzeFixture', { path, sampleRate: rate })
    const original = { source: 'native' as const, continuity: 0, audio: { samples, sampleRate: rate, startFrame: 0 }, origin: onsets[0].time, settings: { bpm: 110, mode: 'straight' as const, startSensitivity: 50, detector: DEFAULT_DETECTOR_SETTINGS }, onsets, results: [], diagnostics, analysis: { implementation: 'forgettime-swift-onset', version: '1' }, endReason: 'stopped' as const }
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
  it('routes real AAC bytes through scoped-copy upload and native decoding after explicit invalid-sidecar fallback', async () => {
    pickPaths = [join(directory, 'encoded/source-44100.m4a'), resolve('tests/fixtures/bar-files/float32-partial.forget')]
    const hook = renderHook(() => usePractice(110, 'straight', 50, undefined, createNativeBarFiles()))
    await act(() => hook.result.current.chooseImportFiles())
    expect(hook.result.current.importState).toMatchObject({ kind: 'fallback' })
    expect(hook.result.current.recordedTake).toBeNull()
    await act(() => hook.result.current.useImportAudioOnly())
    expect(hook.result.current.importState).toMatchObject({ kind: 'setup', bpm: 110, audio: { sampleRate: 44100, channels: 2 } })
    await act(() => hook.result.current.confirmImport(110, .025))
    expect(hook.result.current.recordedTake).toMatchObject({ origin: .025, onsets: [], results: [], source: 'imported' })
    expect(hook.result.current.recordedTake!.diagnostics).toBeUndefined()
    expect(hook.result.current.recordedTake!.audio.samples.length).toBe(8192)
    expect(edge.capture).not.toHaveBeenCalled()
  })

})
