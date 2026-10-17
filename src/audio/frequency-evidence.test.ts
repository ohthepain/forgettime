import { frequencyOverlapFixture } from './fixtures/frequency-overlap'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vite-plus/test'
import { OnsetDetector, type DetectedOnset } from './onset-detector'
import { DEFAULT_DETECTOR_SETTINGS } from './detector-contract'
import { DEFAULT_FREQUENCY_BALANCE, normalizeFrequencyBalance } from './frequency-evidence'
import { decodeWav } from '../../scripts/lib/wav'

it.each([8000, 44100, 48000, 192000])('finds a new band attack over a sustained low tone at %i Hz without following its cycles', rate => {
  const samples = frequencyOverlapFixture(rate).samples, original = samples.slice()
  const energy = new OnsetDetector().process(samples, 0, rate)
  const frequency = new OnsetDetector(undefined, 100).process(samples, 0, rate)
  expect(energy.some(hit => Math.abs(hit.time - .4) < .01)).toBe(false)
  expect(frequency).toHaveLength(1)
  expect(Math.abs(frequency[0].time - .4)).toBeLessThan(.006)
  expect(samples).toEqual(original)
})
it('blends evidence before one decision and retains exact legacy behavior at zero', () => {
  const samples = frequencyOverlapFixture(48000).samples
  const legacy = new OnsetDetector(), zero = new OnsetDetector(undefined, 0)
  expect(zero.process(samples, 0, 48000)).toEqual(legacy.process(samples, 0, 48000))
  expect(zero.drainDiagnostics()).toEqual(legacy.drainDiagnostics())
  const mixed = new OnsetDetector(undefined, 40)
  mixed.process(samples, 0, 48000)
  const candidates = mixed.drainDiagnostics().candidates
  expect(candidates.some(candidate => candidate.evidence)).toBe(true)
  for (const candidate of candidates) {
    const evidence = candidate.evidence!
    expect(evidence.blendedScore).toBeCloseTo(.6 * evidence.energyScore + .4 * evidence.frequencyScore, 12)
    if (candidate.accepted) expect(evidence.blendedScore).toBeGreaterThanOrEqual(1)
  }
})
it.each([50, 100])('is packet-independent and respects discontinuities at %i%%', balance => {
  const samples = frequencyOverlapFixture(48000).samples
  const expected = new OnsetDetector(undefined, balance).process(samples, 0, 48000)
  const detector = new OnsetDetector(undefined, balance), hits: DetectedOnset[] = []
  for (let offset = 0; offset < samples.length; offset += 997) hits.push(...detector.process(samples.subarray(offset, offset + 997), offset / 48000, 48000))
  expect(hits).toHaveLength(expected.length)
  hits.forEach((hit, i) => { expect(hit.time).toBeCloseTo(expected[i].time, 12); expect(hit.confidence).toBe(expected[i].confidence) })
  const restarted = detector.process(samples, 5, 48000)
  expect(restarted).toHaveLength(expected.length)
  restarted.forEach((hit, i) => expect(hit.time).toBeCloseTo(expected[i].time + 5, 12))
})
it('keeps the shared level floor, separation and startup guards at 100%', () => {
  const samples = new Float32Array(48000)
  for (const start of [0, 4800, 5280]) for (let i = 0; i < 128; i++) samples[start + i] = (i % 2 ? -.8 : .8) * Math.exp(-i / 50)
  const detector = new OnsetDetector(undefined, 100)
  const onsets = detector.process(samples, 0, 48000)
  expect(onsets).toHaveLength(1)
  expect(onsets[0].time).toBeCloseTo(.1, 3)
  expect(new OnsetDetector(undefined, 100).process(samples.map(value => value * .0001), 0, 48000)).toEqual([])
  expect(DEFAULT_FREQUENCY_BALANCE).toBe(100)
  expect(normalizeFrequencyBalance(-1)).toBe(0)
  expect(normalizeFrequencyBalance(101)).toBe(100)
})
describe.each(['beat 1 simple 120.wav', 'beat 1 simple dyn 120.wav'])('frequency balance on supplied loop %s', file => {
  const { samples, sampleRate } = decodeWav(readFileSync(new URL(`../../test-data/audio/${file}`, import.meta.url)))
  it.each([25, 50, 100])('preserves eight groups across ten sample alignments at %i%%', balance => {
    for (const lead of [4410, 4423, 4436, 4449, 4462, 4475, 4488, 4501, 4514, 4527]) {
      const pcm = new Float32Array(lead + samples.length); pcm.set(samples, lead)
      const hits = new OnsetDetector(DEFAULT_DETECTOR_SETTINGS, balance).process(pcm, 0, sampleRate)
      expect(hits).toHaveLength(8)
      hits.forEach((hit, index) => expect(Math.abs(hit.time - lead / sampleRate - index * .25)).toBeLessThan(.02))
    }
  })
})
