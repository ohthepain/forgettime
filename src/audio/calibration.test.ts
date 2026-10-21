import { describe, expect, it } from 'vite-plus/test'
import { calibrationClick, measureCalibration } from './calibration'

describe('sample-clock loopback calibration', () => {
  it.each([44100, 48000])('measures a known delay at %i Hz despite polarity and level changes', rate => {
    const pcm = new Float32Array(rate * 7)
    const clicks = Array.from({ length: 8 }, (_, i) => .5 + i * .7)
    const template = calibrationClick(rate)
    clicks.forEach((time, index) => {
      const frame = Math.round((time + .137) * rate)
      for (let j = 0; j < template.length; j++) pcm[frame + j] = template[j] * (index % 2 ? -.4 : .6)
    })
    const result = measureCalibration(pcm, rate, clicks)
    expect(result.seconds).toBeCloseTo(.137, 3)
    expect(result.spreadMs).toBeLessThan(1)
  })
  it('rejects silence instead of saving zero delay', () => {
    expect(() => measureCalibration(new Float32Array(48000 * 7), 48000, Array.from({ length: 8 }, (_, i) => .5 + i * .7))).toThrow('enough clear clicks')
  })
  it('rejects inconsistent delays', () => {
    const rate = 48000, pcm = new Float32Array(rate * 7), template = calibrationClick(rate)
    const clicks = Array.from({ length: 8 }, (_, i) => .5 + i * .7)
    clicks.forEach((time, index) => pcm.set(template, Math.round((time + .03 * index) * rate)))
    expect(() => measureCalibration(pcm, rate, clicks)).toThrow('inconsistent')
  })
})
