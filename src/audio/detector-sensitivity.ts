import { DEFAULT_DETECTOR_SETTINGS, type DetectorSettings } from './detector-contract'

export const DEFAULT_DETECTION_SENSITIVITY = 50
export function sensitivitySettings(value: number): DetectorSettings {
  const sensitivity = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 50))
  const amount = (50 - sensitivity) / 50
  // Keep temporal separation/recovery stable so tuning quiet attacks does not
  // deliberately merge flams or alter long-term level memory.
  return { ...DEFAULT_DETECTOR_SETTINGS,
    minimumRms: DEFAULT_DETECTOR_SETTINGS.minimumRms * Math.pow(amount > 0 ? 20 : 2, amount),
    contrastRatio: amount >= 0 ? 1.8 + amount * 2.2 : 1.8 + amount * .7,
  }
}
