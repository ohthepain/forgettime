import { normalizeInputGain } from './input-gain'

/** Control time animates gain only; it never measures attacks or moves the reference. */
export class AutomaticGain {
  disabled = false
  limited = false
  private ramp: { start: number; end: number; from: number; target: number; rawPeak: number } | null = null
  get adjusting() { return this.ramp !== null }
  reset() { this.disabled = false; this.limited = false; this.ramp = null }
  stop() { this.ramp = null }
  manual() { this.disabled = true; this.stop() }
  observe(samples: Float32Array, appliedGain: number, currentGain: number, now: number) {
    if (this.disabled || !Number.isFinite(appliedGain) || appliedGain <= 0) return
    let peak = 0
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample))
    const rawPeak = peak / appliedGain
    if (this.ramp) {
      this.ramp.rawPeak = Math.max(this.ramp.rawPeak, rawPeak)
      const target = Math.min(this.ramp.target, normalizeInputGain(.9 / this.ramp.rawPeak))
      if (target < this.ramp.target) {
        this.ramp.from = currentGain
        this.ramp.start = now
        this.ramp.target = target
      }
    } else if (peak > 1.25) {
      const target = Math.min(currentGain, normalizeInputGain(.9 / rawPeak))
      this.limited = rawPeak * .1 > 1.25
      if (target < currentGain) this.ramp = { start: now, end: now + 1000, from: currentGain, target, rawPeak }
    }
    if (this.ramp) this.limited = this.ramp.rawPeak * .1 > 1.25
  }
  tick(now: number): number | null {
    if (!this.ramp) return null
    const { start, end, from, target } = this.ramp
    const progress = Math.min(1, Math.max(0, (now - start) / Math.max(1, end - start)))
    const value = from + (target - from) * progress
    if (progress === 1) this.ramp = null
    return value
  }
}
