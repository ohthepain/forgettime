import { trainingNavigation } from '../lib/training-session'
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { webcrypto } from 'node:crypto'
import { importedMaterial } from '../audio/audio-import'
import { createBarFiles, restoreBarFiles } from '../audio/bar-files'
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
beforeEach(() => { if (!document.getElementById('training-import-panel')) { const host = document.createElement('section'); host.id = 'training-import-panel'; document.body.append(host) } })
afterEach(() => { cleanup(); document.querySelectorAll('#training-import-panel').forEach(el => el.remove()) })

function practice(): ReturnType<typeof usePractice> {
  return {
    trainingSamples: [], trainingImportReport: { duplicates: [], errors: [] },
    gainAdjustment: { adjusting: false, limited: false, take: 0 }, manualInputGain: vi.fn(), frequencyBalance: 100, configureBalance: vi.fn(), importState: null, importBusy: false, importError: null, importNotice: null, nativeImportPicker: false,
    beginImport: vi.fn(), cancelImport: vi.fn(), importFiles: vi.fn(), chooseImportFiles: vi.fn(), useImportAudioOnly: vi.fn(), confirmImport: vi.fn(),
    savedBars: [], savedBarsSupported: true, libraryBusy: false, libraryError: null, libraryNotice: null,
    exportSavedPair: vi.fn(), pairedExportSupported: false, saveSelectedBar: vi.fn(), openSavedBar: vi.fn(), exportSavedFile: vi.fn(), openRecordedMaterial: vi.fn(),
    detectionSensitivity: 50, configureSensitivity: vi.fn(),
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
    usePreferences.setState({ bpm: 100, mode: 'auto', inputGain: 1 })
    state = practice()
    vi.mocked(usePractice).mockImplementation(() => state)
  })

  it('routes picker and drop to the same import action and makes beat one keyboard accessible', () => {
    const { rerender } = render(<PracticeScreen />)
    expect(within(screen.getByRole('main')).queryByRole('button', { name: 'Import audio' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Import audio' })).toBeNull()
    const file = new File(['audio'], 'drums.wav', { type: 'audio/wav' })
    act(() => trainingNavigation.importAudio?.())
    expect(state.beginImport).toHaveBeenCalledOnce()
    fireEvent.change(screen.getByLabelText('Choose audio and optional .forget files'), { target: { files: [file] } })
    expect(state.importFiles).toHaveBeenCalledWith([expect.objectContaining({ name: 'drums.wav', size: 5 })], true)
    fireEvent.drop(screen.getByRole('region', { name: 'Import audio files' }), { dataTransfer: { files: [file] } })
    expect(state.importFiles).toHaveBeenCalledTimes(2)
    state = { ...state, importState: { kind: 'setup', file: { name: 'drums.wav', size: 5, read: async () => new ArrayBuffer(5) }, bpm: 110, explanation: 'Confirm reference', audio: { samples: new Float32Array(48000), sampleRate: 48000, channels: 1 } } }
    rerender(<PracticeScreen />)
    fireEvent.change(screen.getByLabelText('Beat one (seconds)'), { target: { value: '0.3' } })
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Beat one position' }), { key: 'ArrowRight' })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm tempo and beat one' }))
    expect(state.confirmImport).toHaveBeenCalledWith(110, .3 + 1 / 48000)
    expect((screen.getByRole('button', { name: 'Enable microphone' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps the confirmed imported waveform in Training when Practice is hidden', () => {
    const take: RecordedTake = { source: 'imported', continuity: 0, origin: 0, settings: { bpm: 91, mode: 'auto', startSensitivity: 50 }, audio: { startFrame: 0, sampleRate: 8000, samples: new Float32Array(24000).fill(.2) }, onsets: [], results: [], endReason: 'stopped', barCount: 2 }
    state = { ...state, importState: { kind: 'setup', file: { name: 'drums.wav', size: 48000, read: async () => new ArrayBuffer(48000) }, bpm: 91, explanation: 'Confirm reference', audio: { samples: take.audio.samples, sampleRate: 8000, channels: 1 } } }
    const { rerender } = render(<div hidden><PracticeScreen active={false} /></div>)
    const training = within(document.getElementById('training-import-panel')!)
    expect(training.getByRole('slider', { name: 'Beat one position' })).toBeDefined()
    fireEvent.click(training.getByRole('button', { name: 'Confirm tempo and beat one' }))
    expect(state.confirmImport).toHaveBeenCalledWith(91, 0)
    state = { ...state, importState: null, recordedTake: take, reviewBar: recordedBar(take, 0), reviewBarCount: 2 }
    rerender(<div hidden><PracticeScreen active={false} /></div>)
    expect(training.getByRole('region', { name: 'One-bar audio waveform' })).toBeDefined()
    fireEvent.click(training.getByRole('button', { name: 'Next bar' }))
    expect(state.nextBar).toHaveBeenCalledOnce()
    fireEvent.click(training.getByRole('button', { name: 'Loop recorded bar' }))
    expect(state.playBar).toHaveBeenCalledOnce()
    rerender(<div><PracticeScreen active /></div>)
    expect(training.queryByRole('region', { name: 'One-bar audio waveform' })).toBeNull()
    expect(screen.getAllByRole('region', { name: 'One-bar audio waveform' })).toHaveLength(1)
  })

  it('offers durable local save and separate WAV and metadata downloads', () => {
    const take: RecordedTake = { source: 'saved', continuity: 0, origin: 0, settings: { bpm: 100, mode: 'auto', startSensitivity: 50 }, audio: { startFrame: 0, sampleRate: 8000, samples: new Float32Array(19200) }, onsets: [], results: [], endReason: 'stopped', barCount: 1 }
    state = { ...state, recordedTake: take, reviewBar: recordedBar(take, 0), reviewBarCount: 1, savedBars: [{ id: 'saved-id', name: 'Bar 1', createdAt: 0, bpm: 100, complete: true, bytes: 100 }] }
    render(<PracticeScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Save bar on device' }))
    expect(state.saveSelectedBar).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Open Bar 1' }))
    expect(state.openSavedBar).toHaveBeenCalledWith('saved-id')
    fireEvent.click(screen.getByRole('button', { name: 'Download WAV for Bar 1' }))
    expect(state.exportSavedFile).toHaveBeenCalledWith('saved-id', 'wav')
    fireEvent.click(screen.getByRole('button', { name: 'Download .forget for Bar 1' }))
    expect(state.exportSavedFile).toHaveBeenCalledWith('saved-id', 'forget')
    expect(screen.getByText('Saved bar · 100 BPM · microphone is off')).toBeDefined()
  })

  it('restores visible tempo and interpretation for a reopened bar before replay starts', () => {
    const take: RecordedTake = { source: 'saved', continuity: 0, origin: -.000003, settings: { bpm: 110, mode: 'swing', startSensitivity: 70 }, audio: { startFrame: 0, sampleRate: 8000, samples: new Float32Array(17455) }, onsets: [], results: [], endReason: 'stopped', barCount: 1 }
    state = { ...state, recordedTake: take, reviewBar: recordedBar(take, 0), reviewBarCount: 1 }
    render(<PracticeScreen />)
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('110')
    expect(screen.getByRole('button', { name: 'Swing / triplet' }).getAttribute('aria-pressed')).toBe('true')
    expect(usePreferences.getState().inputGain).toBe(1)
    expect(state.listen).not.toHaveBeenCalled()
    expect(take.origin).toBe(-.000003)
  })

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
    expect(screen.getByText('Native microphone · live audio · Default detector')).toBeDefined()
    expect(screen.queryByText('Generated hits · microphone is off')).toBeNull()
  })

  it('lets the player select a browser input and shows which microphone is actually live', () => {
    state = { ...state, canSelectInput: true, inputDevices: [{ deviceId: 'mac', label: 'MacBook Microphone', kind: 'audioinput' } as MediaDeviceInfo] }
    const { rerender } = render(<PracticeScreen />)
    expect(screen.queryByRole('combobox', { name: 'MICROPHONE' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Recording options' }))
    const selector = screen.getByRole('combobox', { name: 'MICROPHONE' }) as HTMLSelectElement
    fireEvent.change(selector, { target: { value: 'mac' } })
    expect(state.setDeviceId).toHaveBeenCalledWith('mac')
    state = { ...state, source: 'microphone', deviceId: 'mac', captureInfo: { source: 'web', sampleRate: 48000, timestampQuality: 'sample-clock', inputLabel: 'MacBook Microphone' } }
    rerender(<PracticeScreen />)
    expect(selector.disabled).toBe(true)
    expect(screen.getByText('MacBook Microphone · live audio · Default detector')).toBeDefined()
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
  fireEvent.click(screen.getByRole('button', { name: 'Recording options' }))
  expect((screen.getByRole('button', { name: 'Auto capture' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('spinbutton') as HTMLInputElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Pause recorded bar' }))
  expect(state.stop).toHaveBeenCalled()
})

it('reveals candidate decisions and tunes analysis through the import sensitivity popover', () => {
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
  expect(screen.getByText(/Live capture uses the shared detector defaults/)).toBeDefined()
  fireEvent.click(screen.getAllByRole('button', { name: /Inspect candidate/ })[0])
  expect(screen.getByText('Detector rejected')).toBeDefined()
  expect(screen.getByText(/rise,.*contrast/)).toBeDefined()
  expect(screen.queryByRole('spinbutton', { name: 'Minimum level' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Detection sensitivity' }))
  fireEvent.change(screen.getByRole('slider', { name: 'Detection sensitivity' }), { target: { value: '75' } })
  expect(state.configureSensitivity).toHaveBeenCalledWith(75)
  fireEvent.click(screen.getByRole('button', { name: 'Reset detection sensitivity' }))
  expect(state.configureSensitivity).toHaveBeenLastCalledWith(50)
  expect(state.restartReplay).not.toHaveBeenCalled() // Visibility and candidate selection do not restart.
})


it('keeps unavailable original analysis distinct from zero detections after unpaired import and saved-bar restore', async () => {
  vi.stubGlobal('crypto', webcrypto)
  try {
    const take = importedMaterial({ kind: 'setup', bpm: 120, file: { name: 'example.wav', size: 1, read: async () => new ArrayBuffer(0) }, audio: { samples: new Float32Array(96000), sampleRate: 48000, channels: 1 }, explanation: '' }, { bpm: 120, mode: 'straight', startSensitivity: 50 }, 0)
    state = { ...practice(), recordedTake: take, reviewBar: recordedBar(take, 0), reviewBarCount: 1 }
    vi.mocked(usePractice).mockImplementation(() => state)
    const view = render(<PracticeScreen />)
    expect(screen.getByText(/Original detections unavailable/)).toBeDefined()
    expect(screen.queryByText(/0 original detected hits/)).toBeNull()
    state = { ...state, replayState: { settings: { ...DEFAULT_DETECTOR_SETTINGS }, candidates: [], diagnosticsDropped: 0, metronomeActive: false, run: 1, iteration: 0, time: 0, progress: 0, snapshot: state.snapshot, onsets: [], results: [] } }
    view.rerender(<PracticeScreen />)
    const original = within(screen.getByRole('table', { name: 'Original and current timing comparison' })).getByRole('row', { name: /Original/ })
    expect(original.textContent).toBe('OriginalUnavailableUnavailableUnavailable')
    expect(screen.getByText('Original: analysis unavailable')).toBeDefined()
    const restored = await restoreBarFiles(await createBarFiles(take, 0))
    state = { ...state, recordedTake: restored, reviewBar: recordedBar(restored, 0), replayState: null }
    view.rerender(<PracticeScreen />)
    expect(screen.getByText(/Original detections unavailable/)).toBeDefined()
    expect(screen.queryByText(/0 original detected hits/)).toBeNull()
  } finally { vi.unstubAllGlobals() }
})

it('keeps metronome settings in Settings and removes capture-silence copy from the practice card', () => {
  const prototype = HTMLDialogElement.prototype
  const show = Object.getOwnPropertyDescriptor(prototype, 'showModal'), close = Object.getOwnPropertyDescriptor(prototype, 'close')
  Object.defineProperty(prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open') } })
  state = practice()
  usePreferences.setState({ metronomeEnabled: true, metronomeMode: 'first-bar', helpThresholdMs: 60 })
  vi.mocked(usePractice).mockImplementation(() => state)
  try {
    const { rerender, container } = render(<PracticeScreen />)
    expect(screen.queryByRole('button', { name: 'Metronome sound' })).toBeNull()
    expect(container.querySelector('.capture-mode-note')).toBeNull()
    expect(container.querySelector('.pause-note')).toBeNull()
    expect(screen.queryByText('A full bar of silence to start fresh.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    expect(within(dialog).queryByRole('slider', { name: 'Sensitivity' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Need help' }))
    fireEvent.change(within(dialog).getByRole('slider', { name: 'Timing help threshold' }), { target: { value: '95' } })
    expect(usePreferences.getState().metronomeMode).toBe('need-help')
    expect(usePreferences.getState().helpThresholdMs).toBe(95)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Metronome sound' }))
    expect(usePreferences.getState().metronomeEnabled).toBe(false)
    expect(state.listen).not.toHaveBeenCalled()
    state = { ...state, source: 'simulation' }
    rerender(<PracticeScreen />)
    expect((within(dialog).getByRole('button', { name: 'Metronome sound' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(dialog).getByRole('button', { name: 'Always' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close settings' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Metronome sound' })).toBeNull()
  } finally {
    cleanup()
    if (show) Object.defineProperty(prototype, 'showModal', show); else Reflect.deleteProperty(prototype, 'showModal')
    if (close) Object.defineProperty(prototype, 'close', close); else Reflect.deleteProperty(prototype, 'close')
  }
})

it('exposes an independent frequency balance beside sensitivity and disables both during live capture', () => {
  state = practice()
  vi.mocked(usePractice).mockImplementation(() => state)
  const { rerender } = render(<PracticeScreen />)
  fireEvent.click(screen.getByRole('button', { name: /^Detection sensitivity$/ }))
  const balance = screen.getByRole('slider', { name: 'Detection balance' }) as HTMLInputElement
  const sensitivity = screen.getByRole('slider', { name: 'Detection sensitivity' }) as HTMLInputElement
  expect(balance.value).toBe('100')
  expect(screen.getByText('100%')).toBeDefined()
  fireEvent.change(balance, { target: { value: '35' } })
  expect(state.configureBalance).toHaveBeenCalledWith(35)
  expect(state.configureSensitivity).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Reset detection balance' }))
  expect(state.configureBalance).toHaveBeenLastCalledWith(100)
  state = { ...state, source: 'microphone', detectorSettingsSupported: false }
  rerender(<PracticeScreen />)
  expect(balance.disabled).toBe(true)
  expect(sensitivity.disabled).toBe(true)
  expect(state.listen).not.toHaveBeenCalled()
})


it('opens Settings from the metronome and returns focus without activating capture', () => {
  const prototype = HTMLDialogElement.prototype
  const show = Object.getOwnPropertyDescriptor(prototype, 'showModal'), close = Object.getOwnPropertyDescriptor(prototype, 'close')
  Object.defineProperty(prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open') } })
  state = practice()
  vi.mocked(usePractice).mockImplementation(() => state)
  try {
    render(<PracticeScreen />)
    const metronome = screen.getByRole('button', { name: 'Metronome settings' })
    metronome.focus()
    fireEvent.click(metronome)
    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    expect(within(dialog).getByRole('button', { name: 'Metronome sound' })).toBeDefined()
    expect(state.listen).not.toHaveBeenCalled()
    expect(state.stop).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close settings' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(metronome)
  } finally {
    cleanup()
    if (show) Object.defineProperty(prototype, 'showModal', show); else Reflect.deleteProperty(prototype, 'showModal')
    if (close) Object.defineProperty(prototype, 'close', close); else Reflect.deleteProperty(prototype, 'close')
  }
})

it("stops capture before annotation and blocks source replacement while the editor is open", async () => {
  state = practice();
  const take: RecordedTake = {
    audio: { startFrame: 0, sampleRate: 8000, samples: new Float32Array(24000) },
    source: "web",
    origin: 0.1,
    continuity: 1,
    settings: { bpm: 120, mode: "straight", startSensitivity: 50 },
    onsets: [],
    results: [],
    endReason: "stopped",
  };
  state.recordedTake = take;
  state.reviewBar = recordedBar(take, 0);
  state.reviewBarCount = 2;
  vi.mocked(usePractice).mockImplementation(() => state);
  vi.stubGlobal("indexedDB", {});
  render(<PracticeScreen />);
  fireEvent.click(screen.getByRole("button", { name: "Annotate training attacks" }));
  await waitFor(() =>
    expect(screen.getByRole("region", { name: "Training annotation" })).toBeDefined(),
  );
  expect(state.stop).toHaveBeenCalledOnce();
  expect(state.listen).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Import audio" })).toBeNull();
  expect(
    (screen.getByRole("button", { name: /Try a simulation/ }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(
    (screen.getByRole("button", { name: "Enable microphone" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  vi.unstubAllGlobals();
});


it('opens annotation automatically when a training file finishes loading', async () => {
  state = practice();
  vi.mocked(usePractice).mockImplementation(() => state);
  const view = render(<div hidden><PracticeScreen active={false} /></div>);
  act(() => trainingNavigation.importAudio?.());
  const take: RecordedTake = { source: 'imported', continuity: 0, origin: 0, settings: { bpm: 91, mode: 'auto', startSensitivity: 50 }, audio: { startFrame: 0, sampleRate: 8000, samples: new Float32Array(24000) }, onsets: [], results: [], endReason: 'stopped' };
  state = { ...state, recordedTake: take, reviewBar: recordedBar(take, 0), reviewBarCount: 2 };
  view.rerender(<div hidden><PracticeScreen active={false} /></div>);
  await screen.findByRole('region', { name: 'Training annotation' });
  expect(screen.queryByRole('button', { name: 'Confirm tempo and beat one' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Annotate training attacks' })).toBeNull();
  expect(state.listen).not.toHaveBeenCalled();
});
