import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { InterpretationMode } from '../audio/engine'
import { DEFAULT_START_SENSITIVITY, normalizeStartSensitivity } from '../audio/start-sensitivity'
interface Preferences {
  bpm: number
  mode: InterpretationMode
  startSensitivity: number
  setBpm: (bpm: number) => void
  setMode: (mode: InterpretationMode) => void
  setStartSensitivity: (sensitivity: number) => void
}
export const usePreferences = create<Preferences>()(persist((set) => ({
  bpm: 100,
  mode: 'auto',
  startSensitivity: DEFAULT_START_SENSITIVITY,
  setBpm: bpm => { if (Number.isFinite(bpm)) set({ bpm: Math.max(30, Math.min(300, Math.round(bpm))) }) },
  setMode: mode => set({ mode }),
  setStartSensitivity: value => { if (Number.isFinite(value)) set({ startSensitivity: normalizeStartSensitivity(value) }) },
}), {
  name: 'forgettime-preferences', skipHydration: true, version: 1,
  merge: (stored, current) => {
    const value = (stored ?? {}) as Partial<Preferences>
    return { ...current,
      bpm: typeof value.bpm === 'number' && Number.isFinite(value.bpm) && value.bpm >= 30 && value.bpm <= 300 ? Math.round(value.bpm) : current.bpm,
      mode: value.mode === 'auto' || value.mode === 'straight' || value.mode === 'swing' ? value.mode : current.mode,
      startSensitivity: typeof value.startSensitivity === 'number' && Number.isFinite(value.startSensitivity) && value.startSensitivity >= 0 && value.startSensitivity <= 100
        ? normalizeStartSensitivity(value.startSensitivity) : current.startSensitivity,
    }
  },
}))
