// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PracticeScreen } from './PracticeScreen'
import { usePreferences } from '../lib/preferences'
import { usePractice } from '../audio/use-practice'
import { TimingEngine, type ResolvedHit } from '../audio/engine'
import { emptyWaveform } from '../audio/bar-waveform'

vi.mock('../audio/use-practice', () => ({ usePractice: vi.fn() }))
vi.mock('./AccountDialog', () => ({ AccountDialog: () => null }))

function practice(): ReturnType<typeof usePractice> {
  return {
    snapshot: new TimingEngine({ bpm: 100 }).snapshot(0), source: 'off', busy: false,
    waveform: emptyWaveform(),
    error: null, captureInfo: null, captureNotice: null, outputNotice: null, metronomeActive: false, level: 0,
    inputDevices: [], canSelectInput: false, deviceId: '', setDeviceId: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined), simulate: vi.fn().mockResolvedValue(undefined),
  }
}
let state: ReturnType<typeof usePractice>

describe('practice screen integration', () => {
  beforeEach(() => {
    localStorage.clear()
    usePreferences.setState({ bpm: 100, mode: 'auto' })
    state = practice()
    vi.mocked(usePractice).mockImplementation(() => state)
  })
  afterEach(() => cleanup())

  it('preserves the counter element and hides it before lock and after pause', () => {
    const { container, rerender } = render(<PracticeScreen />)
    const counter = container.querySelector('.beat-counter')!
    expect(counter.getAttribute('aria-hidden')).toBe('true')
    state = { ...state, source: 'microphone', snapshot: { ...state.snapshot, status: 'playing', beat: 3, phaseOrigin: 0 } }
    rerender(<PracticeScreen />)
    expect(container.querySelector('.beat-counter')).toBe(counter)
    expect(counter.getAttribute('aria-hidden')).toBe('false')
    expect(counter.getAttribute('aria-label')).toBe('Beat 3 of 4')
    state = { ...state, snapshot: { ...state.snapshot, status: 'paused', beat: null, phaseOrigin: null } }
    rerender(<PracticeScreen />)
    expect(container.querySelector('.beat-counter')).toBe(counter)
    expect(counter.getAttribute('aria-hidden')).toBe('true')
  })

  it('prevents tempo and mode edits while microphone activation is pending', () => {
    state = { ...state, busy: true }
    render(<PracticeScreen />)
    expect((screen.getByRole('spinbutton') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Auto' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Try a simulation' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('labels generated demonstration hits and live microphone analysis distinctly', () => {
    state = { ...state, source: 'simulation' }
    const { rerender } = render(<PracticeScreen />)
    expect(screen.getByText('SIMULATION')).toBeDefined()
    expect(screen.getByText('Generated hits · microphone is off')).toBeDefined()
    expect((screen.getByRole('spinbutton') as HTMLInputElement).disabled).toBe(true)
    state = { ...state, source: 'microphone', captureInfo: { source: 'native', sampleRate: 48000, timestampQuality: 'hardware' } }
    rerender(<PracticeScreen />)
    expect(screen.getByText('Native microphone · live audio')).toBeDefined()
    expect(screen.queryByText('Generated hits · microphone is off')).toBeNull()
  })

  it('lets the player select a browser input and shows which microphone is actually live', () => {
    state = { ...state, canSelectInput: true, inputDevices: [{ deviceId: 'mac', label: 'MacBook Microphone', kind: 'audioinput' } as MediaDeviceInfo] }
    const { rerender } = render(<PracticeScreen />)
    const selector = screen.getByRole('combobox', { name: 'MICROPHONE' }) as HTMLSelectElement
    fireEvent.change(selector, { target: { value: 'mac' } })
    expect(state.setDeviceId).toHaveBeenCalledWith('mac')
    state = { ...state, source: 'microphone', deviceId: 'mac', captureInfo: { source: 'web', sampleRate: 48000, timestampQuality: 'sample-clock', inputLabel: 'MacBook Microphone' } }
    rerender(<PracticeScreen />)
    expect(selector.disabled).toBe(true)
    expect(screen.getByText('MacBook Microphone · live audio')).toBeDefined()
    expect(screen.queryByText(/reports sound processing/)).toBeNull()
    state = { ...state, captureInfo: { ...state.captureInfo!, processing: { autoGainControl: true } } }
    rerender(<PracticeScreen />)
    expect(screen.getByText(/reports sound processing still enabled/)).toBeDefined()
    state = { ...state, captureInfo: { ...state.captureInfo!, processing: { autoGainControl: false } } }
    rerender(<PracticeScreen />)
    expect(screen.queryByText(/reports sound processing/)).toBeNull()
  })

  it('places early hits left, retains their mounted line through snapshot expiry, and draws no uncertain score', () => {
    const early: ResolvedHit = { id: 10, time: 4, errorMs: -20, confidence: 0.9, subdivision: 'quarter', uncertain: false, displayedAt: 4.24 }
    state = { ...state, source: 'microphone', snapshot: { ...state.snapshot, status: 'playing', beat: 1, phaseOrigin: 0, hits: [early, { ...early, id: 11, errorMs: null, uncertain: true }] } }
    const { container, rerender } = render(<PracticeScreen />)
    const line = container.querySelector('.hit-line') as HTMLElement
    expect(line.style.left).toBe('40%')
    expect(container.querySelectorAll('.hit-line')).toHaveLength(1)
    expect(screen.getByText('Uncertain attack')).toBeDefined()
    state = { ...state, snapshot: { ...state.snapshot, hits: [] } }
    rerender(<PracticeScreen />)
    expect(container.querySelector('.hit-line')).toBe(line)
    // JSDOM lacks AnimationEvent, so React installs the vendor-prefixed event.
    fireEvent(line, new Event('AnimationEvent' in window ? 'animationend' : 'webkitAnimationEnd', { bubbles: true }))
    expect(container.querySelector('.hit-line')).toBeNull()
  })
})
