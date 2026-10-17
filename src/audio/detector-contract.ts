/** Shared browser/native/sidecar contract. Changing semantics requires a new version. */
export const DETECTOR_VERSION = 1 as const
export interface DetectorSettings {
  version: typeof DETECTOR_VERSION
  minimumRms: number
  contrastRatio: number
  minSeparationMs: number
  recoverySeconds: number
}
export type DetectorSettingKey = Exclude<keyof DetectorSettings, 'version'>
export const DETECTOR_CONTROLS: Record<DetectorSettingKey, { label: string; min: number; max: number; step: number; unit: string }> = {
  minimumRms: { label: 'Minimum level', min: 0.001, max: 0.1, step: 0.001, unit: 'RMS' },
  contrastRatio: { label: 'Attack contrast', min: 1.1, max: 4, step: 0.1, unit: '× background' },
  minSeparationMs: { label: 'Minimum separation', min: 8, max: 100, step: 1, unit: 'ms' },
  recoverySeconds: { label: 'Level recovery', min: 0.25, max: 12, step: 0.25, unit: 'seconds' },
}
export const DEFAULT_DETECTOR_SETTINGS: Readonly<DetectorSettings> = Object.freeze({ version: DETECTOR_VERSION, minimumRms: 0.002, contrastRatio: 1.8, minSeparationMs: 18, recoverySeconds: 4 })
export function normalizeDetectorSettings(settings: Partial<DetectorSettings> = {}): DetectorSettings {
  if (settings.version !== undefined && settings.version !== DETECTOR_VERSION) throw new RangeError('Unsupported detector settings version.')
  const result = { ...DEFAULT_DETECTOR_SETTINGS }
  for (const key of Object.keys(DETECTOR_CONTROLS) as DetectorSettingKey[]) {
    const value = settings[key]
    if (value !== undefined && !Number.isFinite(value)) throw new RangeError(`Invalid detector setting: ${key}`)
    result[key] = Math.min(DETECTOR_CONTROLS[key].max, Math.max(DETECTOR_CONTROLS[key].min, value ?? result[key]))
  }
  return result
}
export type DetectorRejectionReason = 'warming-up' | 'level' | 'rise' | 'contrast' | 'rearming' | 'separation'
export interface DetectorCandidate {
  /** Optional review-only evidence; legacy measurements below remain broadband. */
  evidence?: { version: 1; frequencyBalance: number; energyScore: number; frequencyScore: number; blendedScore: number; bandHz: number }
  version: typeof DETECTOR_VERSION
  /** Unique within this detector stream/run; never a wall-clock identifier. */
  id: number
  time: number
  strength: number
  confidence: number
  accepted: boolean
  reasons: DetectorRejectionReason[]
  settings: DetectorSettings
  measurements: {
    rms: number; minimumLevel: number; levelReference: number
    rise: number; minimumRise: number; ratio: number; minimumRatio: number
    contrast: number; minimumContrast: number; backgroundRms: number; baselineRms: number
    armed: boolean; rearmRatio: number
    /** null means no preceding accepted onset, not a measured infinite interval. */
    elapsedMs: number | null; minimumSeparationMs: number
  }
}
export interface ReviewedCandidate extends DetectorCandidate {
  /** Shared live-gate interpretation; legacy acquisition field names remain file-compatible.
   * below-start-level also denotes a sensitivity rejection during active playing.
   * Detector acceptance remains unchanged. */
  acquisition?: 'started' | 'below-start-level' | 'low-confidence' | 'not-required'
  acquisitionGate?: { minimumStrength: number; minimumConfidence: number }
}
export interface DetectorDiagnostics { candidates: DetectorCandidate[]; dropped: number }
export const MAX_DIAGNOSTIC_CANDIDATES = 2048
