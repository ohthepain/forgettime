// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { readFile } from 'node:fs/promises'
import { usePractice } from './use-practice'
import { encodeFloatWav } from './wav'
import { createBarFiles } from './bar-files'
import type { ImportFile } from './audio-import'
const hardware = vi.hoisted(() => ({ capture: vi.fn(), stop: vi.fn() }))
vi.mock('./capture', () => ({ createAudioCapture: hardware.capture }))
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', vi.fn())
  hardware.stop.mockReset().mockResolvedValue(undefined)
  hardware.capture.mockReset().mockReturnValue({ start: async () => ({ source: 'web', sampleRate: 48000, timestampQuality: 'sample-clock' }), stop: hardware.stop, setMetronome: () => {} })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function file(name: string, bytes: ArrayBuffer): ImportFile { return { name, size: bytes.byteLength, read: async () => bytes.slice(0) } }
async function fixture(extension: string) {
  const bytes = await readFile(`tests/fixtures/bar-files/float32-partial.${extension}`)
  return file(`chosen.${extension}`, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
}
it.each([false, true])('restores a selected matching pair regardless of file order without acquisition or setup (%s)', async reverse => {
  const hook = renderHook(() => usePractice(100, 'auto'))
  await act(() => hook.result.current.listen('auto'))
  const files = [await fixture('wav'), await fixture('forget')]
  await act(() => hook.result.current.importFiles(reverse ? files.reverse() : files))
  expect(hook.result.current.source).toBe('off')
  expect(hook.result.current.captureMode).toBe('single')
  expect(hardware.stop).toHaveBeenCalledOnce()
  expect(hardware.capture).toHaveBeenCalledOnce()
  expect(hook.result.current.importState).toBeNull()
  expect(hook.result.current.recordedTake).toMatchObject({ source: 'imported', origin: 0, settings: { bpm: 120 }, barCount: 1 })
  expect(hook.result.current.recordedTake!.audio.samples).toEqual(Float32Array.of(-0, 1.25, -1.5, .125))
})
it('requires explicit tempo and beat-one confirmation for ordinary multibar PCM and preserves its fixed origin through selection', async () => {
  const rate = 44100, samples = new Float32Array(rate * 6)
  for (let beat = 0; beat < 10; beat++) for (let frame = 0; frame < 256; frame++) samples[Math.round((.3 + beat * 60 / 110) * rate) + frame] = Math.sin(frame) * .8 * Math.exp(-frame / 70)
  const hook = renderHook(() => usePractice(110, 'straight'))
  await act(() => hook.result.current.importFiles([file('drums.wav', encodeFloatWav(samples, rate))]))
  expect(hook.result.current.recordedTake).toBeNull()
  expect(hook.result.current.importState).toMatchObject({ kind: 'setup', bpm: 110 })
  await act(() => hook.result.current.confirmImport(110, .3))
  expect(hook.result.current.recordedTake).toMatchObject({ source: 'imported', origin: .3, settings: { bpm: 110, mode: 'straight' }, onsets: [], results: [] })
  expect(hook.result.current.recordedTake!.diagnostics).toBeUndefined()
  expect(hook.result.current.recordedTake!.audio.samples).toEqual(samples)
  expect(hook.result.current.reviewBarCount).toBe(3)
  await act(() => hook.result.current.nextBar())
  expect(hook.result.current.reviewBarIndex).toBe(1)
  expect(hook.result.current.recordedTake!.origin).toBe(.3)
  expect(hardware.capture).not.toHaveBeenCalled()
  const selected = hook.result.current.reviewBar!.audio.samples.slice()
  const pair = await createBarFiles(hook.result.current.recordedTake!, 1)
  await act(() => hook.result.current.importFiles([file('renamed.forget', new TextEncoder().encode(pair.sidecar).buffer), file('another-name.wav', pair.wav)]))
  expect(hook.result.current.reviewBarCount).toBe(1)
  expect(hook.result.current.recordedTake!.settings.bpm).toBe(110)
  expect(hook.result.current.recordedTake!.audio.samples).toEqual(selected)
  expect(hook.result.current.recordedTake!.diagnostics).toBeUndefined()
})
it.each([[24, 44100], [32, 48000]])('imports stereo PCM%i at %i Hz with arithmetic channel averaging', async (bits, rate) => {
  const bytes = new ArrayBuffer(44 + 8 * bits / 8), view = new DataView(bytes)
  const word = (at: number, text: string) => [...text].forEach((c, index) => view.setUint8(at + index, c.charCodeAt(0)))
  word(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); word(8, 'WAVE'); word(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true); view.setUint32(24, rate, true); view.setUint32(28, rate * bits / 4, true); view.setUint16(32, bits / 4, true); view.setUint16(34, bits, true); word(36, 'data'); view.setUint32(40, 8 * bits / 8, true)
  const limit = 2 ** (bits - 1), samples = [limit - 1, -(limit - 1), limit / 2, limit / 2, -limit, -limit, limit / 4, limit / 4]
  samples.forEach((value, index) => { const at = 44 + index * bits / 8; if (bits === 32) view.setInt32(at, value, true); else { view.setUint16(at, value & 65535, true); view.setUint8(at + 2, (value >> 16) & 255) } })
  const hook = renderHook(() => usePractice(110, 'straight'))
  await act(() => hook.result.current.importFiles([file('stereo.wav', bytes)]))
  expect(hook.result.current.importState).toMatchObject({ kind: 'setup', audio: { channels: 2, sampleRate: rate } })
  await act(() => hook.result.current.confirmImport(110, 0))
  expect(hook.result.current.recordedTake!.audio.samples).toEqual(Float32Array.of(0, .5, -1, .25))
})
it('explains a mismatched sidecar and only enters ordinary setup after choosing audio alone', async () => {
  const hook = renderHook(() => usePractice(110, 'straight'))
  const wav = file('chosen.wav', encodeFloatWav(Float32Array.of(.5, .25, 0, -.25), 8000))
  await act(async () => hook.result.current.importFiles([await fixture('forget'), wav]))
  expect(hook.result.current.importState).toMatchObject({ kind: 'fallback', explanation: expect.stringContaining('does not match') })
  expect(hook.result.current.recordedTake).toBeNull()
  await act(() => hook.result.current.useImportAudioOnly())
  expect(hook.result.current.importState).toMatchObject({ kind: 'setup', bpm: 110 })
  await act(() => hook.result.current.confirmImport(110, 0))
  expect(hook.result.current.recordedTake).toMatchObject({ settings: { bpm: 110 }, onsets: [], results: [] })
})
it('preserves the previous review when selection is cancelled or a delayed file read finishes after cancellation', async () => {
  const hook = renderHook(() => usePractice(100, 'auto'))
  await act(async () => hook.result.current.importFiles([await fixture('wav'), await fixture('forget')]))
  const original = hook.result.current.recordedTake
  await act(() => hook.result.current.importFiles([]))
  expect(hook.result.current.recordedTake).toBe(original)
  let complete!: (bytes: ArrayBuffer) => void, pending!: Promise<void>
  act(() => { pending = hook.result.current.importFiles([{ name: 'later.wav', size: 44, read: () => new Promise(resolve => { complete = resolve }) }]) })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  await act(() => hook.result.current.cancelImport())
  await act(async () => { complete(new ArrayBuffer(44)); await pending })
  expect(hook.result.current.importBusy).toBe(false)
  expect(hook.result.current.importState).toBeNull()
  expect(hook.result.current.recordedTake).toBe(original)
  expect(hook.result.current.source).toBe('off')
})
it('rejects oversized files before reading, ambiguous selections and unsupported compressed decode without replacing review', async () => {
  const decode = vi.fn().mockRejectedValue(new Error('Unsupported M4A codec'))
  const hook = renderHook(() => usePractice(100, 'auto', 50, undefined, { importer: { decode } }))
  await act(async () => hook.result.current.importFiles([await fixture('wav'), await fixture('forget')]))
  const original = hook.result.current.recordedTake, read = vi.fn()
  await act(() => hook.result.current.importFiles([{ name: 'huge.m4a', size: 64 * 1024 * 1024 + 1, read }]))
  expect(read).not.toHaveBeenCalled()
  expect(hook.result.current.importError).toContain('size limits')
  await act(() => hook.result.current.importFiles([file('audio.m4a', new ArrayBuffer(16))]))
  expect(hook.result.current.importError).toBe('Unsupported M4A codec')
  await act(async () => hook.result.current.importFiles([await fixture('wav'), await fixture('wav')]))
  expect(hook.result.current.importError).toContain('Choose one')
  expect(hook.result.current.recordedTake).toBe(original)
})

it('routes the platform picker through the same paired validation and validates platform decoded PCM', async () => {
  const pair = [await fixture('forget'), await fixture('wav')]
  const decode = vi.fn().mockResolvedValue({ samples: Float32Array.of(.5, -.5, 0), sampleRate: 48000, channels: 2 })
  const pick = vi.fn().mockResolvedValue(pair)
  const hook = renderHook(() => usePractice(110, 'straight', 50, undefined, { importer: { pick, decode } }))
  await act(() => hook.result.current.chooseImportFiles())
  expect(hook.result.current.recordedTake!.settings.bpm).toBe(120)
  expect(decode).not.toHaveBeenCalled()
  await act(() => hook.result.current.importFiles([file('ordinary.m4a', new ArrayBuffer(16))]))
  expect(hook.result.current.importState).toMatchObject({ kind: 'setup', audio: { sampleRate: 48000, channels: 2 } })
  await act(() => hook.result.current.confirmImport(110, 0))
  expect(hook.result.current.recordedTake!.audio.samples).toEqual(Float32Array.of(.5, -.5, 0))
  decode.mockResolvedValue({ samples: Float32Array.of(NaN), sampleRate: 48000, channels: 2 })
  await act(() => hook.result.current.importFiles([file('invalid.m4a', new ArrayBuffer(16))]))
  expect(hook.result.current.importError).toContain('invalid samples')
})
it.each(['{not-json', '{"format":"forgettime-bar","schemaVersion":2}'])('offers ordinary setup instead of silently accepting unsupported metadata: %s', async sidecar => {
  const hook = renderHook(() => usePractice(110, 'straight'))
  const wav = await fixture('wav')
  await act(() => hook.result.current.importFiles([wav, file('chosen.forget', new TextEncoder().encode(sidecar).buffer)]))
  expect(hook.result.current.importState).toMatchObject({ kind: 'fallback', explanation: expect.stringContaining('Unsupported or invalid') })
  expect(hook.result.current.recordedTake).toBeNull()
})


it.each([
  ['Splice_drums_091_loop.wav', 91],
  ['loop_50bpm.wav', 50],
  ['loop_300.wav', 300],
  ['loop_91.5_bpm.wav', 91.5],
  ['loop_44100_120.wav', 120],
  ['loop_49_301_44100.wav', 110],
  ['drums.wav', 110],
])('prefills tempo from %s while requiring confirmation', async (name, bpm) => {
  const hook = renderHook(() => usePractice(110, 'straight'));
  await act(() => hook.result.current.importFiles([file(name, encodeFloatWav(new Float32Array(8000), 8000))]));
  expect(hook.result.current.importState).toMatchObject({ kind: 'setup', bpm });
  expect(hook.result.current.recordedTake).toBeNull();
  await act(() => hook.result.current.confirmImport(95, 0));
  expect(hook.result.current.recordedTake?.settings.bpm).toBe(95);
});

it('loads a training sample directly at source zero with filename tempo and no confirmation setup', async () => {
  const hook = renderHook(() => usePractice(110, 'straight'));
  await act(() => hook.result.current.importFiles([file('splice_91_drums.wav', encodeFloatWav(new Float32Array(24000), 8000))], true));
  expect(hook.result.current.importState).toBeNull();
  expect(hook.result.current.recordedTake).toMatchObject({ source: 'imported', origin: 0, settings: { bpm: 91 } });
  expect(hook.result.current.reviewBarIndex).toBe(0);
  expect(hardware.capture).not.toHaveBeenCalled();
});

it('retains a batch for annotation and skips duplicates from later imports', async () => {
  const hook = renderHook(() => usePractice(110, 'straight'));
  const a = encodeFloatWav(Float32Array.of(.1, .2), 8000), b = encodeFloatWav(Float32Array.of(.3, .4), 8000);
  await act(() => hook.result.current.importFiles([file('first_91.wav', a), file('second_120.wav', b), file('copy.wav', a)], true));
  expect(hook.result.current.trainingSamples.map(sample => sample.name)).toEqual(['first_91.wav', 'second_120.wav']);
  expect(hook.result.current.trainingImportReport.duplicates).toEqual(['copy.wav']);
  const take = hook.result.current.recordedTake;
  await act(() => hook.result.current.importFiles([file('renamed.wav', b)], true));
  expect(hook.result.current.recordedTake).toBe(take);
  expect(hook.result.current.trainingSamples).toHaveLength(2);
  expect(hook.result.current.trainingImportReport.duplicates).toEqual(['renamed.wav']);
  expect(hook.result.current.importNotice).toBeNull();
});

it('restores imported, unannotated files from the catalog after remounting with the microphone off', async () => {
  let saved: import('./training-import').PendingTrainingSample[] = [];
  const catalog = {
    read: vi.fn(async () => structuredClone(saved)),
    add: vi.fn(async (samples: import('./training-import').PendingTrainingSample[]) => { saved = [...saved, ...structuredClone(samples)]; return structuredClone(saved); }),
  };
  const options = { trainingSamples: catalog, latestPerformance: null };
  const first = renderHook(() => usePractice(110, 'straight', 1, undefined, options));
  await act(() => first.result.current.importFiles([file('one.wav', encodeFloatWav(Float32Array.of(.1), 8000)), file('two.wav', encodeFloatWav(Float32Array.of(.2), 8000))], true));
  expect(catalog.add).toHaveBeenCalledOnce();
  first.unmount();
  const reopened = renderHook(() => usePractice(110, 'straight', 1, undefined, options));
  await act(async () => {});
  expect(reopened.result.current.trainingSamples.map(sample => sample.name)).toEqual(['one.wav', 'two.wav']);
  expect(reopened.result.current.source).toBe('off');
  expect(reopened.result.current.recordedTake).toBeNull();
  expect(hardware.capture).not.toHaveBeenCalled();
});

it('reports catalog write failures without pretending the new sample was imported', async () => {
  const catalog = { read: async () => [], add: async () => { throw new Error('Quota exceeded'); } };
  const hook = renderHook(() => usePractice(110, 'straight', 1, undefined, { trainingSamples: catalog, latestPerformance: null }));
  await act(() => hook.result.current.importFiles([file('one.wav', encodeFloatWav(Float32Array.of(.1), 8000))], true));
  expect(hook.result.current.trainingSamples).toEqual([]);
  expect(hook.result.current.recordedTake).toBeNull();
  expect(hook.result.current.importError).toBe('Quota exceeded');
});
