import { describe, expect, it } from 'vitest'
import { WaveformEnvelopeCapture } from './waveform-envelope'

describe('captured PCM waveform envelopes', () => {
  it.each([44100, 48000])('preserves single-sample peaks and sample timestamps across callback boundaries at %i Hz', rate => {
    const size = Math.round(rate * 0.002)
    const samples = new Float32Array(size * 30)
    samples[size - 1] = 0.9
    samples[size] = -0.8
    const whole = new WaveformEnvelopeCapture().process(samples, 100, rate)
    const capture = new WaveformEnvelopeCapture()
    const chunks = []
    for (let i = 0; i < samples.length; i += 97) chunks.push(...capture.process(samples.subarray(i, i + 97), 100 + i / rate, rate))
    expect(chunks).toHaveLength(30)
    chunks.forEach((point, i) => {
      expect(point.time).toBeCloseTo(whole[i].time, 10)
      expect(point).toMatchObject({ min: whole[i].min, max: whole[i].max, duration: size / rate })
    })
    expect(chunks[0].max).toBeCloseTo(0.9)
    expect(chunks[1].min).toBeCloseTo(-0.8)
    expect(chunks[2]).toMatchObject({ min: 0, max: 0 })
  })

  it('discards partial windows across gaps and rate changes, without fabricating a connecting waveform', () => {
    const capture = new WaveformEnvelopeCapture()
    expect(capture.process(new Float32Array(90).fill(1), 0, 48000)).toEqual([])
    expect(capture.process(new Float32Array(96), 10, 48000)).toEqual([{ time: 10, duration: 0.002, min: 0, max: 0 }])
    expect(capture.process(new Float32Array(88).fill(Number.NaN), 20, 44100)).toEqual([{ time: 20, duration: 88 / 44100, min: 0, max: 0 }])
  })
})
