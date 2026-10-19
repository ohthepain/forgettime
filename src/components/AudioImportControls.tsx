import { trainingNavigation } from '../lib/training-session'
import { useEffect, useRef, useState } from 'react'
import { DetectionSensitivity } from './DetectionSensitivity'
import { ImportWaveform } from './ImportWaveform'
import { browserImportFile } from '../audio/audio-import'
import type { usePractice } from '../audio/use-practice'
type ImportPractice = Pick<ReturnType<typeof usePractice>, 'importState' | 'importBusy' | 'importError' | 'importNotice' | 'beginImport' | 'cancelImport' | 'importFiles' | 'chooseImportFiles' | 'useImportAudioOnly' | 'confirmImport' | 'nativeImportPicker' | 'frequencyBalance' | 'configureBalance' | 'detectorSettings' | 'detectionSensitivity' | 'configureSensitivity' | 'detectorSettingsSupported'>
export function AudioImportControls({ practice, showImportButton = true }: { practice: ImportPractice; showImportButton?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const element = input.current, cancel = () => { void practice.cancelImport() }
    element?.addEventListener('cancel', cancel)
    return () => element?.removeEventListener('cancel', cancel)
  }, [practice.cancelImport])
  function openPicker() {
    if (practice.nativeImportPicker) void practice.chooseImportFiles();
    else { void practice.beginImport(); input.current?.click(); }
  }
  useEffect(() => {
    trainingNavigation.importAudio = openPicker;
    return () => { trainingNavigation.importAudio = undefined; };
  });
  const state = practice.importState
  const [bpm, setBpm] = useState(100), [beatOne, setBeatOne] = useState(0)
  useEffect(() => { if (state) { setBpm(state.bpm); setBeatOne(0) } }, [state])
  const audio = state?.kind === 'setup' ? state.audio : null
  const duration = audio ? audio.samples.length / audio.sampleRate : 0
  const maximum = audio ? (audio.samples.length - 1) / audio.sampleRate : 0
  function place(value: number) { if (Number.isFinite(value)) setBeatOne(Math.max(0, Math.min(maximum, value))) }
  return <section className="audio-import" aria-label="Import audio files" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void practice.importFiles(Array.from(event.dataTransfer.files).map(browserImportFile)) }}>
    {showImportButton && <button data-testid="import-audio" onClick={openPicker} disabled={practice.importBusy}>Import audio</button>}
    <DetectionSensitivity frequencyBalance={practice.frequencyBalance} changeBalance={value => void practice.configureBalance(value)} value={practice.detectionSensitivity} disabled={!practice.detectorSettingsSupported} change={value => void practice.configureSensitivity(value)} />
    <input ref={input} data-testid="import-audio-files" type="file" multiple accept=".wav,.m4a,.forget,audio/wav,audio/mp4" hidden aria-label="Choose audio and optional .forget files" onChange={event => { const files = Array.from(event.target.files ?? []).map(browserImportFile); event.target.value = ''; void practice.importFiles(files) }} />
    {(showImportButton || state) && <p className="import-instructions">{practice.nativeImportPicker ? 'Choose WAV or M4A, with an optional .forget file.' : 'Drop WAV or M4A here, with an optional .forget file.'} Up to 120 seconds / 64 MiB. Microphone turns off during import.</p>}
    {practice.importBusy && <p role="status">Reading selected audio…</p>}
    {state && <div className="import-setup" data-testid="import-audio-setup">
      <p>{state.explanation}</p>
      {state.kind === 'fallback' ? <button data-testid="import-audio-only" onClick={() => void practice.useImportAudioOnly()} disabled={practice.importBusy}>Use audio only</button> : <>
        <p>{state.file.name} · {duration.toFixed(2)} seconds · {state.audio.sampleRate.toLocaleString()} Hz · {state.audio.channels > 1 ? `${state.audio.channels} channels averaged to mono` : 'mono'}</p>
        <label>Import tempo (BPM)<input data-testid="import-tempo" aria-label="Import tempo (BPM)" type="number" min={30} max={300} value={bpm} onChange={event => setBpm(Number(event.target.value))} /></label>
        <ImportWaveform key={state.file.name + ':' + state.audio.samples.length} audio={state.audio} bpm={bpm} beatOne={beatOne} place={place} settings={practice.detectorSettings} frequencyBalance={practice.frequencyBalance} />
        <label>Beat one (seconds)<input data-testid="import-beat-one" aria-label="Beat one (seconds)" type="number" min={0} max={maximum} step={1 / state.audio.sampleRate} value={beatOne} onChange={event => place(Number(event.target.value))} /></label>
        <p>Tap away from a marker or use arrow keys to place beat one; Shift moves 10 ms. Audio before beat one stays in the source but is outside bar review.</p>
        <button data-testid="confirm-audio-import" onClick={() => void practice.confirmImport(bpm, beatOne)} disabled={practice.importBusy}>Confirm tempo and beat one</button>
      </>}
      <button onClick={() => void practice.cancelImport()}>Cancel import</button>
    </div>}
    {practice.importBusy && !state && <button onClick={() => void practice.cancelImport()}>Cancel import</button>}
    {practice.importError && <p className="error-message" role="alert">{practice.importError}</p>}
    {practice.importNotice && <p role="status">{practice.importNotice}</p>}
  </section>
}
