/** Octave-spaced causal band-pass filters. Band energy growth supplies attack
 * evidence, rather than another list of onsets. Keep Java/Swift mirrors aligned.
 * This is not source separation and cannot recover cancelled mono audio. */
export class FrequencyEvidence {
  private bands: {
    hz: number; b: number; a1: number; a2: number; x1: number; x2: number; y1: number; y2: number
    rearmEnergy: number; rearmRms: number; rawPrevious: number; preBackground: number; background: number; fullContrast: number; clearWindow: number; energy: number; previous: number; peak: number; armed: boolean; history: Float64Array; sum: number
  }[]
  private filtered = new Float64Array(0)
  private windowIndex = 0
  private index = 0
  private count = 0
  constructor(sampleRate: number) {
    this.bands = [80, 160, 320, 640, 1280, 2560, 5120, 10240].filter(hz => hz < sampleRate * .45).map(hz => {
      const omega = 2 * Math.PI * hz / sampleRate, alpha = Math.sin(omega) / (2 * Math.SQRT1_2)
      return { hz, b: alpha / (1 + alpha), a1: -2 * Math.cos(omega) / (1 + alpha), a2: (1 - alpha) / (1 + alpha),
        rearmEnergy: 0, rearmRms: 0, rawPrevious: 0, preBackground: 0, background: 0, fullContrast: 0, clearWindow: -1000000, x1: 0, x2: 0, y1: 0, y2: 0, energy: 0, previous: 0, peak: 0, armed: true, history: new Float64Array(12), sum: 0 }
    })
  }
  analyze(samples: Float32Array, sampleRate: number, minimumRms: number, contrastRatio: number) {
    let score = 0, bandHz = 0, offset = 0
    const floor = minimumRms * .25
    const smoothing = 1 - Math.exp(-samples.length / sampleRate / .003)
    if (this.filtered.length !== samples.length) this.filtered = new Float64Array(samples.length)
    for (const band of this.bands) {
      let energy = 0, peak = 0, peakOffset = 0
      // Store only this short analysis window; timestamps remain on the PCM clock.
      const filtered = this.filtered
      for (let i = 0; i < samples.length; i++) {
        const x = samples[i]
        const y = band.b * (x - band.x2) - band.a1 * band.y1 - band.a2 * band.y2
        band.x2 = band.x1; band.x1 = x; band.y2 = band.y1; band.y1 = y
        filtered[i] = y; energy += y * y
        if (Math.abs(y) > peak) { peak = Math.abs(y); peakOffset = i }
      }
      const rawRms = Math.sqrt(energy / samples.length)
      const rawRatio = rawRms / Math.max(band.rawPrevious, floor)
      band.rawPrevious = rawRms
      band.energy += (energy / samples.length - band.energy) * smoothing
      band.rearmEnergy += (energy / samples.length - band.rearmEnergy) * (1 - Math.exp(-samples.length / sampleRate / .01))
      band.rearmRms = Math.sqrt(Math.max(0, band.rearmEnergy))
      const rms = Math.sqrt(Math.max(0, band.energy))
      const background = Math.sqrt(Math.max(0, band.sum) / Math.max(1, this.count))
      if (band.rearmRms < band.peak * .7) band.armed = true
      const ratio = rms / Math.max(band.previous, floor)
      let shortEnergy = 0
      for (let i = 1; i <= 3; i++) shortEnergy += band.history[(this.index + 12 - i) % 12]
      band.background = background; band.fullContrast = rms / Math.max(background, floor)
      const baseline = (this.windowIndex - band.clearWindow) * samples.length / sampleRate < .09 && rawRatio >= 2.5
        ? Math.min(background, Math.max(Math.sqrt(Math.max(0, shortEnergy) / 3), band.preBackground)) : background
      const bandScore = Math.max(0, Math.min(2, (rms - band.previous) / .0005,
        ratio / 1.55, rms / Math.max(baseline, floor) / contrastRatio, band.armed ? 2 : ratio / 4))
      if (bandScore > score) {
        score = bandScore; bandHz = band.hz
        const threshold = Math.max(peak * .25, band.previous * 2)
        let crossing = 0
        while (crossing < peakOffset && Math.abs(filtered[crossing]) < threshold) crossing++
        offset = crossing
      }
      band.sum += band.energy - band.history[this.index]
      band.history[this.index] = band.energy
      band.previous = rms
      band.peak = Math.max(band.rearmRms, band.peak * .99)
    }
    this.windowIndex++
    this.index = (this.index + 1) % 12
    this.count = Math.min(this.count + 1, 12)
    return { score, bandHz, offset }
  }
  accept(contrastRatio: number) {
    // Rearm each band independently, allowing a new hat over a sustained kick.
    for (const band of this.bands) {
      band.armed = false; band.peak = band.rearmRms
      if (band.fullContrast >= contrastRatio) { band.clearWindow = this.windowIndex - 1; band.preBackground = band.background }
    }
  }
}
export const DEFAULT_FREQUENCY_BALANCE = 100
export function normalizeFrequencyBalance(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : DEFAULT_FREQUENCY_BALANCE
}
