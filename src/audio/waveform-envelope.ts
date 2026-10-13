/** Peak envelope of a short captured PCM window; times use the audio sample clock. */
export interface WaveformEnvelope { time: number; duration: number; min: number; max: number }

/** 2 ms min/max windows preserve transients without retaining or bridging raw PCM. */
export class WaveformEnvelopeCapture {
  private rate = 0
  private size = 0
  private count = 0
  private start = 0
  private min = Infinity
  private max = -Infinity
  private expected: number | null = null

  reset() {
    this.rate = 0
    this.count = 0
    this.min = Infinity
    this.max = -Infinity
    this.expected = null
  }

  process(samples: Float32Array, startTime: number, rate: number): WaveformEnvelope[] {
    if (!Number.isFinite(startTime) || !Number.isFinite(rate) || rate < 8000) throw new RangeError('Invalid waveform sample clock')
    if (rate !== this.rate || (this.expected !== null && Math.abs(startTime - this.expected) > 2 / rate)) {
      this.reset()
      this.rate = rate
      this.size = Math.max(1, Math.round(rate * 0.002))
    }
    const points: WaveformEnvelope[] = []
    for (let i = 0; i < samples.length; i++) {
      if (this.count === 0) this.start = startTime + i / rate
      const sample = Number.isFinite(samples[i]) ? samples[i] : 0
      this.min = Math.min(this.min, sample)
      this.max = Math.max(this.max, sample)
      if (++this.count === this.size) {
        points.push({ time: this.start, duration: this.size / rate, min: this.min, max: this.max })
        this.count = 0
        this.min = Infinity
        this.max = -Infinity
      }
    }
    this.expected = startTime + samples.length / rate
    return points
  }
}
