// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { usePreferences } from './preferences'

describe('persisted practice preferences', () => {
  beforeEach(() => { localStorage.clear(); usePreferences.setState({ bpm: 100, mode: 'auto' }) })

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
  })
})
