export const DEFAULT_INPUT_GAIN = 1
export function normalizeInputGain(value: number): number {
  return Number.isFinite(value) ? Math.max(0.25, Math.min(8, value)) : DEFAULT_INPUT_GAIN
}
/** Float32 multiplication before detection and retention; never normalize imports. */
export function amplifyMicrophone(samples: Float32Array, gain: number): Float32Array {
  return samples.map(sample => sample * normalizeInputGain(gain))
}
