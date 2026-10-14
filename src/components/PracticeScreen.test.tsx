// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PracticeScreen } from './PracticeScreen'
import { usePreferences } from '../lib/preferences'
import { usePractice } from '../audio/use-practice'
import { TimingEngine, type ResolvedHit } from '../audio/engine'
import { DEFAULT_DETECTOR_SETTINGS } from '../audio/detector-contract'
import { OnsetDetector } from '../audio/onset-detector'
import { recordedBar, type RecordedTake } from '../audio/recorded-take'
import { emptyWaveform } from '../audio/bar-waveform'

vi.mock('../audio/use-practice', () => ({ usePractice: vi.fn() }))
vi.mock('./AccountDialog', () => ({ AccountDialog: () => null }))
afterEach(() => cleanup())

function practice(): ReturnType<typeof usePractice> {
  return {
    detectorSettings: { ...DEFAULT_DETECTOR_SETTINGS }, configureDetector: vi.fn(), resetDetector: vi.fn(), detectorSettingsSupported: true, liveDiagnostics: { candidates: [], dropped: 0, supported: false },
    playBar: vi.fn(), restartReplay: vi.fn(), replayState: null,
    recordedTake: null, reviewBar: null, reviewBarIndex: 0, reviewBarCount: 0, recordingNotice: null,
    previousBar: vi.fn(), nextBar: vi.fn(), reviewCurrentBar: vi.fn(),
    snapshot: new TimingEngine({ bpm: 100 }).snapshot(0), captureTime: 0, source: 'off', captureMode: 'single', busy: false,
    waveform: emptyWaveform(), waveformSource: 'microphone',
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

it('offers waveform loop playback, identifies replay, and preserves original/current comparison', () => {
  const take: RecordedTake = { audio: { samples: new Float32Array(96000), startFrame: 0, sampleRate: 48000 }, source: 'web', continuity: 0, origin: 0, settings: { bpm: 120, mode: 'straight', startSensitivity: 50 }, onsets: [], results: [], endReason: 'stopped' }
  state = { ...practice(), recordedTake: take, reviewBar: recordedBar(take, 0), reviewBarCount: 1 }
  vi.mocked(usePractice).mockImplementation(() => state)
  const { rerender } = render(<PracticeScreen />)
  fireEvent.click(screen.getByRole('button', { name: 'Loop recorded bar' }))
  expect(state.playBar).toHaveBeenCalled()
  state = { ...state, source: 'replay', snapshot: { ...state.snapshot, bpm: 120, status: 'playing', phaseOrigin: 0, beat: 1 }, replayState: { settings: { ...DEFAULT_DETECTOR_SETTINGS }, candidates: [], diagnosticsDropped: 0, metronomeActive: false, run: 1, iteration: 1, time: 2, progress: 0, snapshot: state.snapshot, onsets: [], results: [] } }
  rerender(<PracticeScreen />)
  expect(screen.getByText('BAR REPLAY')).toBeDefined()
  expect(screen.getByText(/Fresh looping state can differ/)).toBeDefined()
  expect(screen.getByRole('button', { name: 'Original capture' })).toBeDefined()
  expect(screen.getByRole('button', { name: 'Current loop' })).toBeDefined()
  expect((screen.getByRole('button', { name: 'Auto capture' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('spinbutton') as HTMLInputElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Pause recorded bar' }))
  expect(state.stop).toHaveBeenCalled()
})

it('reveals candidate decisions accessibly and commits detector controls separately from Start sensitivity', () => {
  const detector = new OnsetDetector()
  const pcm = new Float32Array(48000)
  for (let i = 0; i < 128; i++) pcm[4800 + i] = (i % 2 ? -0.003 : 0.003)
  detector.process(pcm, 0, 48000)
  const diagnostics = detector.drainDiagnostics()
  state = { ...practice(), liveDiagnostics: { ...diagnostics, supported: true } }
  vi.mocked(usePractice).mockImplementation(() => state)
  render(<PracticeScreen />)
  expect(screen.queryByRole('group', { name: 'Detector controls' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Detection details' }))
  expect(screen.getByText(/Start sensitivity only gates live acquisition/)).toBeDefined()
  fireEvent.click(screen.getAllByRole('button', { name: /Inspect candidate/ })[0])
  expect(screen.getByText('Detector rejected')).toBeDefined()
  expect(screen.getByText(/level,.*contrast/)).toBeDefined()
  const control = screen.getByRole('spinbutton', { name: 'Minimum level' })
  fireEvent.change(control, { target: { value: '0.02' } })
  fireEvent.blur(control)
  expect(state.configureDetector).toHaveBeenCalledWith({ minimumRms: 0.02 })
  fireEvent.click(screen.getByRole('button', { name: 'Reset detector defaults' }))
  expect(state.resetDetector).toHaveBeenCalled()
  expect(state.restartReplay).not.toHaveBeenCalled() // Visibility and candidate selection do not restart.
})
