import type { DetectedOnset } from './onset-detector'
import type { WaveformEnvelope } from './waveform-envelope'

/** Display-only synthesized envelopes. Never used by the microphone capture path. */
export function simulationWaveform(from: number, to: number, hits: DetectedOnset[]): WaveformEnvelope[] {
  const result: WaveformEnvelope[] = []
  // Bound work if the demonstration renderer was suspended for a long time.
  const first = Math.max(Math.floor(from / 0.002), Math.floor((to - 8) / 0.002))
  for (let i = first; i < Math.floor(to / 0.002); i++) {
    const time = i * 0.002
    let peak = 0
    for (const hit of hits) {
      const age = time - hit.time
      if (age >= -0.002 && age < 0.3) peak += hit.strength * Math.exp(-Math.max(0, age) / 0.035)
    }
    peak = Math.min(1, peak * (0.7 + 0.3 * Math.abs(Math.sin(i * 2.17))))
    result.push({ time, duration: 0.002, min: -peak * 0.8, max: peak })
  }
  return result
}
