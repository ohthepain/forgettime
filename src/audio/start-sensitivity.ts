export const DEFAULT_START_SENSITIVITY = 25

export function normalizeStartSensitivity(value: number): number {
  return Number.isFinite(value) ? Math.round(Math.max(0, Math.min(100, value))) : DEFAULT_START_SENSITIVITY
}

/** Peak PCM amplitude, after the detector's transient/noise checks. Higher is easier. */
export function startingStrength(sensitivity: number): number {
  return 0.5 * Math.pow(0.04, normalizeStartSensitivity(sensitivity) / 100)
}
