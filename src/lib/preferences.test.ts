// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { usePreferences } from './preferences'

describe('persisted practice preferences', () => {
  beforeEach(() => { localStorage.clear(); usePreferences.setState({ bpm: 100, mode: 'auto', startSensitivity: 50, metronomeEnabled: true, metronomeMode: 'first-bar', helpThresholdMs: 100 }) })

  it('restores metronome mode, mute and threshold while rejecting malformed saved values', async () => {
    const state = usePreferences.getState()
    state.setMetronomeMode('need-help')
    state.setMetronomeEnabled(false)
    state.setHelpThresholdMs(65)
    const saved = localStorage.getItem('forgettime-preferences')!
    usePreferences.setState({ metronomeEnabled: true, metronomeMode: 'first-bar', helpThresholdMs: 100 })
    localStorage.setItem('forgettime-preferences', saved)
    await usePreferences.persist.rehydrate()
    expect(usePreferences.getState()).toMatchObject({ metronomeEnabled: false, metronomeMode: 'need-help', helpThresholdMs: 65 })
    localStorage.setItem('forgettime-preferences', JSON.stringify({ version: 1, state: { metronomeMode: 'bad', metronomeEnabled: 'yes', helpThresholdMs: -100, setHelpThresholdMs: 'bad' } }))
    await usePreferences.persist.rehydrate()
    expect(usePreferences.getState()).toMatchObject({ metronomeEnabled: false, metronomeMode: 'need-help', helpThresholdMs: 65 })
    state.setHelpThresholdMs(NaN)
    expect(usePreferences.getState().helpThresholdMs).toBe(65)
    state.setHelpThresholdMs(500)
    expect(usePreferences.getState().helpThresholdMs).toBe(200)
  })

  it.each([null, 0, -1, 301, '120', {}])('rejects malformed stored tempo %s without breaking the engine', async bpm => {
    localStorage.setItem('forgettime-preferences', JSON.stringify({ version: 1, state: { bpm, mode: 'unknown', setBpm: 'not a function' } }))
    await usePreferences.persist.rehydrate()
    expect(usePreferences.getState().bpm).toBe(100)
    expect(usePreferences.getState().mode).toBe('auto')
    expect(typeof usePreferences.getState().setBpm).toBe('function')
  })

  it('restores validated preferences and ignores nonfinite setter input', async () => {
    localStorage.setItem('forgettime-preferences', JSON.stringify({ version: 1, state: { bpm: 135, mode: 'swing' } }))
    await usePreferences.persist.rehydrate()
    expect(usePreferences.getState()).toMatchObject({ bpm: 135, mode: 'swing' })
    usePreferences.getState().setBpm(Number.NaN)
    expect(usePreferences.getState().bpm).toBe(135)
    expect(usePreferences.getState().startSensitivity).toBe(50)
  })

  it('persists start sensitivity and clamps edits while ignoring invalid values', async () => {
    usePreferences.getState().setStartSensitivity(73)
    const saved = localStorage.getItem('forgettime-preferences')!
    expect(JSON.parse(saved).state.startSensitivity).toBe(73)
    usePreferences.setState({ startSensitivity: 50 }, false)
    localStorage.setItem('forgettime-preferences', saved)
    await usePreferences.persist.rehydrate()
    expect(usePreferences.getState().startSensitivity).toBe(73)
    usePreferences.getState().setStartSensitivity(150)
    expect(usePreferences.getState().startSensitivity).toBe(100)
    usePreferences.getState().setStartSensitivity(Number.NaN)
    expect(usePreferences.getState().startSensitivity).toBe(100)
    usePreferences.getState().setStartSensitivity(-1)
    expect(usePreferences.getState().startSensitivity).toBe(0)
  })

  it.each([null, -1, 101, '80', {}])('rejects malformed saved sensitivity %s', async startSensitivity => {
    localStorage.setItem('forgettime-preferences', JSON.stringify({ version: 1, state: { startSensitivity, setStartSensitivity: 'bad' } }))
    await usePreferences.persist.rehydrate()
    expect(usePreferences.getState().startSensitivity).toBe(50)
    expect(typeof usePreferences.getState().setStartSensitivity).toBe('function')
  })
})
