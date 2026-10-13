import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { InterpretationMode } from '../audio/engine'
interface Preferences {
  bpm: number
  mode: InterpretationMode
  setBpm: (bpm: number) => void
  setMode: (mode: InterpretationMode) => void
}
export const usePreferences = create<Preferences>()(persist((set) => ({
  bpm: 100,
  mode: 'auto',
  setBpm: bpm => { if (Number.isFinite(bpm)) set({ bpm: Math.max(30, Math.min(300, Math.round(bpm))) }) },
  setMode: mode => set({ mode }),
}), {
  name: 'forgettime-preferences', skipHydration: true, version: 1,
  merge: (stored, current) => {
    const value = (stored ?? {}) as Partial<Preferences>
    return { ...current,
      bpm: typeof value.bpm === 'number' && Number.isFinite(value.bpm) && value.bpm >= 30 && value.bpm <= 300 ? Math.round(value.bpm) : current.bpm,
      mode: value.mode === 'auto' || value.mode === 'straight' || value.mode === 'swing' ? value.mode : current.mode,
    }
  },
}))
