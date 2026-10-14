import { useEffect, useMemo, useRef, useState } from 'react'
import { browserImportFile } from '../audio/audio-import'
import type { usePractice } from '../audio/use-practice'
type ImportPractice = Pick<ReturnType<typeof usePractice>, 'importState' | 'importBusy' | 'importError' | 'importNotice' | 'beginImport' | 'cancelImport' | 'importFiles' | 'chooseImportFiles' | 'useImportAudioOnly' | 'confirmImport' | 'nativeImportPicker'>
export function AudioImportControls({ practice }: { practice: ImportPractice }) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const element = input.current, cancel = () => { void practice.cancelImport() }
    element?.addEventListener('cancel', cancel)
    return () => element?.removeEventListener('cancel', cancel)
  }, [practice.cancelImport])
  const state = practice.importState
  const [bpm, setBpm] = useState(100), [beatOne, setBeatOne] = useState(0)
  useEffect(() => { if (state) { setBpm(state.bpm); setBeatOne(0) } }, [state])
  const audio = state?.kind === 'setup' ? state.audio : null
  const duration = audio ? audio.samples.length / audio.sampleRate : 0
  const maximum = audio ? (audio.samples.length - 1) / audio.sampleRate : 0
  const path = useMemo(() => {
    if (!audio) return ''
    const columns = 512, low = new Float32Array(columns), high = new Float32Array(columns)
    let peak = .001
    for (let i = 0; i < audio.samples.length; i++) { const x = Math.min(columns - 1, Math.floor(i / audio.samples.length * columns)), sample = audio.samples[i]; low[x] = Math.min(low[x], sample); high[x] = Math.max(high[x], sample); peak = Math.max(peak, Math.abs(sample)) }
    return Array.from(low, (sample, x) => `M${x},${32 - sample / peak * 28}V${32 - high[x] / peak * 28}`).join('')
  }, [audio])
  function place(value: number) { if (Number.isFinite(value)) setBeatOne(Math.max(0, Math.min(maximum, value))) }
  return <section className="audio-import" aria-label="Import audio files" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void practice.importFiles(Array.from(event.dataTransfer.files).map(browserImportFile)) }}>
    <button onClick={() => { if (practice.nativeImportPicker) void practice.chooseImportFiles(); else { void practice.beginImport(); input.current?.click() } }} disabled={practice.importBusy}>Import audio</button>
    <input ref={input} type="file" multiple accept=".wav,.m4a,.forget,audio/wav,audio/mp4" hidden aria-label="Choose audio and optional .forget files" onChange={event => { const files = Array.from(event.target.files ?? []).map(browserImportFile); event.target.value = ''; void practice.importFiles(files) }} />
    <p>{practice.nativeImportPicker ? 'Choose WAV or M4A, with an optional .forget file.' : 'Drop WAV or M4A here, with an optional .forget file.'} Up to 120 seconds / 64 MiB. Microphone turns off during import.</p>
    {practice.importBusy && <p role="status">Reading selected audio…</p>}
    {state && <div className="import-setup">
      <p>{state.explanation}</p>
      {state.kind === 'fallback' ? <button onClick={() => void practice.useImportAudioOnly()} disabled={practice.importBusy}>Use audio only</button> : <>
        <p>{state.file.name} · {duration.toFixed(2)} seconds · {state.audio.sampleRate.toLocaleString()} Hz · {state.audio.channels > 1 ? `${state.audio.channels} channels averaged to mono` : 'mono'}</p>
        <label>Import tempo (BPM)<input aria-label="Import tempo (BPM)" type="number" min={30} max={300} value={bpm} onChange={event => setBpm(Number(event.target.value))} /></label>
        <svg viewBox="0 0 512 64" preserveAspectRatio="none" role="slider" tabIndex={0} aria-label="Beat one position" aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={beatOne} aria-valuetext={`${beatOne.toFixed(6)} seconds`} onPointerDown={event => { const bounds = event.currentTarget.getBoundingClientRect(); if (bounds.width) place((event.clientX - bounds.left) / bounds.width * duration) }} onKeyDown={event => {
          if (['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const step = event.shiftKey ? .01 : 1 / state.audio.sampleRate; place(event.key === 'Home' ? 0 : event.key === 'End' ? maximum : beatOne + (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -step : step)) }
        }}><path d={path} className="waveform-trace" /><line x1={beatOne / duration * 512} x2={beatOne / duration * 512} y1={0} y2={64} stroke="#b7e3bb" strokeWidth={2} /></svg>
        <label>Beat one (seconds)<input aria-label="Beat one (seconds)" type="number" min={0} max={maximum} step={1 / state.audio.sampleRate} value={beatOne} onChange={event => place(Number(event.target.value))} /></label>
        <p>Click the waveform or use arrow keys to place beat one; Shift moves 10 ms. Audio before beat one stays in the source but is outside bar review.</p>
        <button onClick={() => void practice.confirmImport(bpm, beatOne)} disabled={practice.importBusy}>Confirm tempo and beat one</button>
      </>}
      <button onClick={() => void practice.cancelImport()}>Cancel import</button>
    </div>}
    {practice.importBusy && !state && <button onClick={() => void practice.cancelImport()}>Cancel import</button>}
    {practice.importError && <p className="error-message" role="alert">{practice.importError}</p>}
    {practice.importNotice && <p role="status">{practice.importNotice}</p>}
  </section>
}
