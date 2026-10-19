import { expect, it } from 'vite-plus/test';
import { webcrypto } from 'node:crypto';
import { prepareTrainingImport } from './training-import';
import { createTrainingSource } from './training-contract';
import { encodeFloatWav } from './wav';
import type { ImportFile } from './audio-import';
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
const settings = { bpm: 110, mode: 'straight' as const, startSensitivity: 50 };
const adapter = { decode: async () => { throw new Error('Unsupported'); } };
function file(name: string, samples: Float32Array): ImportFile {
  const bytes = encodeFloatWav(samples, 8000);
  return { name, size: bytes.byteLength, read: async () => bytes };
}
it('loads multiple unique samples in order and reports renamed or existing audio only as duplicates', async () => {
  const first = Float32Array.of(.1, .2), existing = Float32Array.of(.3, .4), third = Float32Array.of(.5, .6);
  const known = await createTrainingSource([existing], 8000, { kind: 'import', beginningAvailable: true, endAvailable: true });
  const result = await prepareTrainingImport([file('one_91.wav', first), file('already_there.wav', existing), file('renamed.wav', first), file('three_120.wav', third)], adapter, settings, new Set([known.source.checksum]));
  expect(result.samples.map(sample => sample.name)).toEqual(['one_91.wav', 'three_120.wav']);
  expect(result.samples.map(sample => sample.take.settings.bpm)).toEqual([91, 120]);
  expect(result.samples.every(sample => sample.take.origin === 0)).toBe(true);
  expect(result.report.duplicates).toEqual(['already_there.wav', 'renamed.wav']);
  expect(result.report.errors).toEqual([]);
});
it('retains successful samples around errors and enforces the retained memory budget', async () => {
  const pcm = Float32Array.of(.1, .2);
  const result = await prepareTrainingImport([file('good.wav', pcm), { name: 'broken.wav', size: 4, read: async () => new ArrayBuffer(4) }, file('over_limit.wav', Float32Array.of(.3, .4))], adapter, settings, new Set(), 256 * 1024 * 1024 - 8);
  expect(result.samples.map(sample => sample.name)).toEqual(['good.wav']);
  expect(result.report.errors.map(error => error.name)).toEqual(['broken.wav', 'over_limit.wav']);
});
it('does not retain samples after cancellation', async () => {
  const result = await prepareTrainingImport([file('one.wav', Float32Array.of(.1))], adapter, settings, new Set(), 0, 100, () => false);
  expect(result.samples).toEqual([]);
});
