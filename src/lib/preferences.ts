import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { InterpretationMode } from '../audio/engine'
import { DEFAULT_START_SENSITIVITY, normalizeStartSensitivity } from '../audio/start-sensitivity'
import { DEFAULT_METRONOME, normalizeHelpThreshold, type MetronomeMode } from '../audio/metronome'
interface Preferences {
  bpm: number
  mode: InterpretationMode
  startSensitivity: number
  metronomeEnabled: boolean
  metronomeMode: MetronomeMode
  helpThresholdMs: number
  setMetronomeEnabled: (enabled: boolean) => void
  setMetronomeMode: (mode: MetronomeMode) => void
  setHelpThresholdMs: (value: number) => void
  setBpm: (bpm: number) => void
  setMode: (mode: InterpretationMode) => void
  setStartSensitivity: (sensitivity: number) => void
}
export const usePreferences = create<Preferences>()(persist((set) => ({
  bpm: 100,
  mode: 'auto',
  startSensitivity: DEFAULT_START_SENSITIVITY,
  metronomeEnabled: DEFAULT_METRONOME.enabled,
  metronomeMode: DEFAULT_METRONOME.mode,
  helpThresholdMs: DEFAULT_METRONOME.thresholdMs,
  setMetronomeEnabled: metronomeEnabled => set({ metronomeEnabled }),
  setMetronomeMode: metronomeMode => set({ metronomeMode }),
  setHelpThresholdMs: value => { if (Number.isFinite(value)) set({ helpThresholdMs: normalizeHelpThreshold(value) }) },
  setBpm: bpm => { if (Number.isFinite(bpm)) set({ bpm: Math.max(30, Math.min(300, Math.round(bpm))) }) },
  setMode: mode => set({ mode }),
  setStartSensitivity: value => { if (Number.isFinite(value)) set({ startSensitivity: normalizeStartSensitivity(value) }) },
}), {
  name: 'forgettime-preferences', skipHydration: true, version: 1,
  merge: (stored, current) => {
    const value = (stored ?? {}) as Partial<Preferences>
    return { ...current,
      metronomeEnabled: typeof value.metronomeEnabled === 'boolean' ? value.metronomeEnabled : current.metronomeEnabled,
      metronomeMode: ['first-bar', 'always', 'need-help'].includes(value.metronomeMode ?? '') ? value.metronomeMode! : current.metronomeMode,
      helpThresholdMs: typeof value.helpThresholdMs === 'number' && Number.isFinite(value.helpThresholdMs) && value.helpThresholdMs >= 20 && value.helpThresholdMs <= 200
        ? normalizeHelpThreshold(value.helpThresholdMs) : current.helpThresholdMs,
      bpm: typeof value.bpm === 'number' && Number.isFinite(value.bpm) && value.bpm >= 30 && value.bpm <= 300 ? Math.round(value.bpm) : current.bpm,
      mode: value.mode === 'auto' || value.mode === 'straight' || value.mode === 'swing' ? value.mode : current.mode,
      startSensitivity: typeof value.startSensitivity === 'number' && Number.isFinite(value.startSensitivity) && value.startSensitivity >= 0 && value.startSensitivity <= 100
        ? normalizeStartSensitivity(value.startSensitivity) : current.startSensitivity,
    }
  },
}))
