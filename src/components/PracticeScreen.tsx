import { RecordControl } from './RecordControl'
import { AudioImportControls } from './AudioImportControls'
import { useEffect, useState } from 'react'
import { AudioLines, CircleHelp, Settings, UserRound } from 'lucide-react'
import { usePreferences } from '../lib/preferences'
import { usePractice } from '../audio/use-practice'
import { usePresentedHits } from '../audio/use-presented-hits'
import { AccountDialog } from './AccountDialog'
import { SettingsDialog } from './SettingsDialog'
import { DetectionDetails, type InspectableCandidate } from './DetectionDetails'
import { BarWaveform } from './BarWaveform'
import { BeatPendulum } from './BeatPendulum'
import type { InterpretationMode } from '../audio/engine'

const MODES: { value: InterpretationMode; label: string }[] = [
  { value: 'auto', label: 'Auto' }, { value: 'straight', label: 'Straight' }, { value: 'swing', label: 'Swing / triplet' },
]
export function PracticeScreen() {
  const { bpm, mode, inputGain, setBpm, setMode, metronomeEnabled, metronomeMode, helpThresholdMs } = usePreferences()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [candidatePage, setCandidatePage] = useState(0)
  const [inspectedCandidate, setInspectedCandidate] = useState<InspectableCandidate | null>(null)
  const [currentComparison, setCurrentComparison] = useState(true)
  const [tempoText, setTempoText] = useState(String(bpm))
  const [accountOpen, setAccountOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const practice = usePractice(bpm, mode, inputGain, { enabled: metronomeEnabled, mode: metronomeMode, thresholdMs: helpThresholdMs })
  const { snapshot, source, busy, error } = practice
  const importPending = practice.importBusy || Boolean(practice.importState)
  const running = source !== 'off'
  const playing = snapshot.status === 'playing'
  const showBeat = running && playing && snapshot.beat !== null
  const review = (source === 'replay' || !playing) && source !== 'simulation' ? practice.reviewBar : null
  const replay = practice.replayState
  const currentHits = replay?.onsets.filter(hit => hit.iteration === replay.iteration) ?? []
  const currentResults = replay?.results.filter(hit => hit.iteration === replay.iteration) ?? []
  const originalTake = practice.recordedTake
  const originalAvailable = Boolean(originalTake && (originalTake.source === 'web' || originalTake.source === 'native' || originalTake.provenance?.kind === 'capture' || originalTake.analysis || originalTake.diagnostics || originalTake.onsets.length || originalTake.results.length))
  const originalResults = review ? practice.recordedTake?.results.filter(hit => hit.time >= review.start && hit.time < review.end) ?? [] : []
  const reviewWaveform = review ? { ...review.waveform, progress: source === 'replay' && replay ? replay.progress : review.waveform.progress, hits: currentComparison && replay ? currentHits : review.waveform.hits } : null
  const diagnosticOrigin = review?.start ?? snapshot.phaseOrigin
  const liveBarStart = diagnosticOrigin === null ? null : diagnosticOrigin + Math.floor((practice.captureTime - diagnosticOrigin) / (240 / snapshot.bpm)) * (240 / snapshot.bpm)
  const candidates: InspectableCandidate[] = review
    ? currentComparison && replay ? replay.candidates.filter(candidate => candidate.iteration === replay.iteration).map(candidate => ({ ...candidate, uncertain: replay.results.some(hit => hit.time === candidate.time && hit.uncertain) }))
      : (practice.recordedTake?.diagnostics?.candidates ?? []).filter(candidate => candidate.time >= review.start && candidate.time < review.end).map(candidate => ({ ...candidate, position: (candidate.time - review.start) / (review.end - review.start), uncertain: originalResults.some(hit => hit.time === candidate.time && hit.uncertain) }))
    : practice.liveDiagnostics.candidates.map(candidate => ({ ...candidate, position: liveBarStart === null ? undefined : (candidate.time - liveBarStart) / (240 / snapshot.bpm), uncertain: snapshot.hits.some(hit => hit.time === candidate.time && hit.uncertain) }))
  const activeCandidatePage = Math.min(candidatePage, Math.max(0, Math.ceil(candidates.length / 20) - 1))
  const visibleCandidates = candidates.slice(activeCandidatePage * 20, activeCandidatePage * 20 + 20)
  const diagnosticsSupported = review ? currentComparison && replay ? true : Boolean(practice.recordedTake?.diagnostics) : practice.liveDiagnostics.supported
  const diagnosticsDropped = review ? currentComparison && replay ? replay.diagnosticsDropped : practice.recordedTake?.diagnostics?.dropped ?? 0 : practice.liveDiagnostics.dropped
  useEffect(() => { setInspectedCandidate(null); setCandidatePage(0) }, [replay?.run, practice.reviewBarIndex, currentComparison])
  const inputProcessing = practice.captureInfo?.processing
  const hasInputProcessing = inputProcessing?.autoGainControl === true
    || inputProcessing?.echoCancellation === true || inputProcessing?.noiseSuppression === true
  const presented = usePresentedHits(snapshot.hits, playing)
  useEffect(() => { void usePreferences.persist.rehydrate() }, [])
  useEffect(() => { setTempoText(String(bpm)) }, [bpm])
  useEffect(() => {
    const take = practice.recordedTake
    if (take?.source !== 'saved' && take?.source !== 'imported') return
    // Restore musical preferences; microphone gain is independent of retained material.
    usePreferences.setState({ bpm: take.settings.bpm, mode: take.settings.mode })
  }, [practice.recordedTake])
  const status = source === 'replay' ? `Loop ${(replay?.iteration ?? 0) + 1} · ${snapshot.bpm} BPM fixed` : busy ? 'Opening microphone…' : snapshot.status === 'playing' ? `Playing · ${bpm} BPM locked`
    : snapshot.status === 'paused' ? 'Paused · listening for you'
    : snapshot.status === 'listening' ? 'Listening · play your first hit' : null
  const latest = snapshot.hits.at(-1)
  const lastScored = [...snapshot.hits].reverse().find(hit => !hit.uncertain && hit.errorMs !== null)
  const detail = latest?.uncertain ? 'Uncertain attack' : lastScored?.errorMs !== undefined && lastScored.errorMs !== null
    ? Math.abs(lastScored.errorMs) < 5 ? 'Right in the pocket' : `${Math.abs(Math.round(lastScored.errorMs))} ms ${lastScored.errorMs < 0 ? 'ahead' : 'behind'}`
    : playing ? 'Beat set' : snapshot.status === 'paused' ? 'Ready when you are' : null
  async function inspectReview(action: () => void | Promise<void>) {
    if (review && source === 'microphone') await practice.reviewCurrentBar()
    await action()
  }
  const inspectCandidate = (candidate: InspectableCandidate) => { void inspectReview(() => setInspectedCandidate(candidate)) }
  function commitTempo() {
    const next = Number(tempoText)
    if (Number.isFinite(next) && next >= 30 && next <= 300) setBpm(next)
    else setTempoText(String(bpm))
  }
  return <main className="app-shell">
    <header className="app-header"><a className="wordmark" href="/" aria-label="Forgettime home"><AudioLines size={21} strokeWidth={1.5} />forgettime<span className="wordmark-dot">.</span></a>
      <div className="header-actions"><button className="icon-button" onClick={() => setHelpOpen(!helpOpen)} aria-label="How it works" aria-expanded={helpOpen}><CircleHelp size={19} /></button><button className="icon-button" onClick={() => setAccountOpen(true)} aria-label="Your account"><UserRound size={19} /></button><button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="Settings" aria-haspopup="dialog" aria-expanded={settingsOpen}><Settings size={19} /></button></div>
    </header>
    <section className="tempo-card" aria-label="Drum timing practice">
      <div className="practice-toolbar" role="group" aria-label="Practice controls">
        <RecordControl gainAdjustment={practice.gainAdjustment} manualInputGain={practice.manualInputGain} active={running} auto={practice.captureMode === 'auto'} busy={busy} disabled={importPending}
          microphone={practice.canSelectInput ? { devices: practice.inputDevices, deviceId: practice.deviceId, select: practice.setDeviceId } : undefined}
          stopLabel={busy ? 'Cancel microphone' : source === 'simulation' ? 'Stop simulation' : source === 'replay' ? 'Pause playback' : 'Stop listening'} listen={practice.listen} stop={practice.stop} />
        <button className="metronome-settings" aria-label="Metronome settings" aria-haspopup="dialog" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(true)}>
        <span className={`beat-counter ${showBeat ? 'is-visible' : ''}`} role="timer" aria-live="off" aria-hidden={!showBeat} aria-label={showBeat ? `Beat ${snapshot.beat} of 4` : undefined}>
          <span className="beat-current"><span className="beat-number">
            <BeatPendulum time={practice.captureTime} origin={snapshot.phaseOrigin} bpm={snapshot.bpm} active={showBeat} />
            <span className="beat-number-value">{snapshot.beat ?? 1}</span>
          </span><span className="beat-caption">BEAT<br />OF 4</span></span>
          <span className="beat-dots" aria-hidden="true">{[1, 2, 3, 4].map(beat => <i key={beat} className={snapshot.beat === beat ? 'active' : ''} />)}</span>
        </span>
        </button>
        <div className="bpm-control"><input id="bpm" aria-label="Tempo in beats per minute" inputMode="numeric" type="number" min={30} max={300} step={1} value={source === 'replay' ? snapshot.bpm : tempoText} disabled={busy || source === 'simulation' || source === 'replay'} onChange={event => setTempoText(event.target.value)} onBlur={commitTempo} onKeyDown={event => { if (event.key === 'Enter') { commitTempo(); event.currentTarget.blur() } }} /><label htmlFor="bpm">BPM</label></div>
      </div>
      {(source === 'simulation' || source === 'replay' || (review && source === 'off')) && <p className="practice-label">{source === 'simulation' ? 'SIMULATION' : source === 'replay' ? 'BAR REPLAY' : 'BAR REVIEW'}</p>}
      {status && <p className="playing-status" role="status"><span className={`status-dot ${running ? 'active' : ''}`} />{status}</p>}
      <div className="timing-meter" role="img" aria-label="Timing meter. Early hits appear left, late hits right. Each line fades over one second.">
        <div className="centre-band" /><div className="centre-line" />
        {presented.hits.map(hit => <div key={hit.id} className={`hit-line ${Math.abs(hit.errorMs!) > 100 ? 'out-of-range' : ''}`} style={{ left: `${50 + Math.max(-100, Math.min(100, hit.errorMs!)) / 2}%` }} data-error-ms={hit.errorMs!.toFixed(2)} onAnimationEnd={() => presented.removeHit(hit.id)} />)}
        <span className="meter-hint">{playing ? 'Stay with your time' : snapshot.status === 'paused' ? 'Play to begin again' : running ? 'Your first strong hit sets beat 1' : 'A little more in time, every time.'}</span>
      </div>
      <div className="meter-scale"><span>−100 ms</span><span>0</span><span>+100 ms</span></div>
      {detail && <div className="result-area"><p className={latest?.uncertain ? 'result uncertain' : 'result'}>{detail}</p><p className="result-note">{latest?.uncertain ? 'No timing score for this hit' : playing ? 'Reference stays fixed as you play' : null}</p></div>}
      <BarWaveform waveform={reviewWaveform ?? practice.waveform} source={source === 'replay' ? 'replay' : review ? 'microphone' : source === 'off' && practice.waveform.review ? practice.waveformSource : source}
        status={snapshot.status}
        diagnostics={detailsOpen && source !== 'simulation' ? { candidates: visibleCandidates, selectedId: inspectedCandidate?.id, select: inspectCandidate } : undefined}
        review={review ? { originalAvailable, index: practice.reviewBarIndex, count: practice.reviewBarCount, availableFraction: review.availableFraction, interrupted: review.endReason === 'interrupted', previous: () => void practice.previousBar(), next: () => void practice.nextBar(), select: () => void practice.reviewCurrentBar(), loop: () => void (source === 'replay' ? practice.stop() : practice.playBar()), canLoop: review.complete && !busy } : undefined}
        comparison={review && replay ? { current: currentComparison, select: setCurrentComparison } : undefined} />
      <AudioImportControls practice={{ ...practice, detectorSettingsSupported: practice.detectorSettingsSupported || Boolean(review && source === 'microphone'), configureBalance: value => inspectReview(() => practice.configureBalance(value)), configureSensitivity: value => inspectReview(() => practice.configureSensitivity(value)) }} />
      <section className="saved-bars" aria-label="Saved bars">
        {review && <button disabled={practice.libraryBusy || !practice.savedBarsSupported} onClick={() => void practice.saveSelectedBar()}>Save bar on device</button>}
        <details><summary>Saved bars ({practice.savedBars.length})</summary>
          <p>Audio stays on this device. Up to 100 bars / 256 MiB. Browser storage can be cleared; download both files for a portable copy.</p>
          {practice.savedBarsSupported === false && <p>Local saved bars are unavailable in this version on this device.</p>}
          <ul>{practice.savedBars.map(bar => <li key={bar.id}>
            <span>{bar.name}{!bar.complete && ' · partial'}</span>
            <div><button aria-label={`Open ${bar.name}`} disabled={practice.libraryBusy || busy || importPending} onClick={() => void practice.openSavedBar(bar.id)}>Open</button>
              {practice.pairedExportSupported ? <button disabled={practice.libraryBusy} onClick={() => void practice.exportSavedPair(bar.id)}>Export WAV + .forget</button> : <><button aria-label={`Download WAV for ${bar.name}`} disabled={practice.libraryBusy} onClick={() => void practice.exportSavedFile(bar.id, 'wav')}>WAV ↓</button>
              <button aria-label={`Download .forget for ${bar.name}`} disabled={practice.libraryBusy} onClick={() => void practice.exportSavedFile(bar.id, 'forget')}>.forget ↓</button></>}</div>
          </li>)}</ul>
        </details>
        {practice.libraryBusy && <p role="status">Working with local files…</p>}
        {practice.libraryNotice && <p role="status">{practice.libraryNotice}</p>}
        {practice.libraryError && <p className="error-message" role="alert">{practice.libraryError}</p>}
      </section>
      {review && practice.recordedTake && <p className="source-note">{practice.recordedTake.source === 'saved' ? 'Saved bar' : practice.recordedTake.source === 'imported' ? 'Imported audio' : 'Recorded audio'} · {practice.recordedTake.settings.bpm} BPM · {source === 'microphone' ? 'microphone is listening' : 'microphone is off'}</p>}
      {review && replay && <div className="replay-results">
        <table aria-label="Original and current timing comparison"><thead><tr><th>Analysis</th><th>Detected</th><th>Scored</th><th>Uncertain</th></tr></thead><tbody>
          <tr><th>Original</th><td>{originalAvailable ? review.waveform.hits.length : 'Unavailable'}</td><td>{originalAvailable ? originalResults.filter(hit => !hit.uncertain).length : 'Unavailable'}</td><td>{originalAvailable ? originalResults.filter(hit => hit.uncertain).length : 'Unavailable'}</td></tr>
          <tr><th>Loop {replay.iteration + 1}</th><td>{currentHits.length}</td><td>{currentResults.filter(hit => !hit.uncertain).length}</td><td>{currentResults.filter(hit => hit.uncertain).length}</td></tr>
        </tbody></table>
        <details><summary>Timing results</summary><p>Original: {originalAvailable ? originalResults.map(hit => hit.uncertain ? 'uncertain' : `${Math.round(hit.errorMs!)} ms`).join(', ') || 'No scored hits' : 'analysis unavailable'}</p>
          <p>Current: {replay.results.map(hit => `Loop ${hit.iteration + 1}: ${hit.uncertain ? 'uncertain' : `${Math.round(hit.errorMs!)} ms`}`).join(', ') || 'Waiting for resolved hits'}</p></details>
        <p className="waveform-note">Fresh looping state can differ from original capture. Later repetitions may settle differently; loop joins can add attacks.</p>
      </div>}
      {source !== 'simulation' && <DetectionDetails open={detailsOpen} toggle={() => void inspectReview(() => setDetailsOpen(value => !value))} settings={practice.detectorSettings}
        originalSettings={practice.recordedTake?.settings.detector}
        candidates={candidates} selected={inspectedCandidate} select={inspectCandidate} page={activeCandidatePage} setPage={page => void inspectReview(() => setCandidatePage(page))}
        dropped={diagnosticsDropped} diagnosticsSupported={diagnosticsSupported} context={review ? currentComparison && replay ? `Current loop ${replay.iteration + 1} · fresh run ${replay.run}` : 'Original capture' : source === 'microphone' ? 'Live detector candidates' : 'Latest live candidates'} />}
      <div className="interpretation"><span className="small-label">INTERPRETATION</span><div className="mode-control" role="group" aria-label="Rhythm interpretation">{MODES.map(item => <button key={item.value} aria-pressed={mode === item.value} onClick={() => setMode(item.value)} disabled={busy || source === 'simulation' || source === 'replay'}>{item.label}</button>)}</div></div>

      {practice.recordingNotice && <p className="capture-notice" role="status">{practice.recordingNotice}</p>}
      {error && <p className="error-message" role="alert">{error}</p>}
      {practice.captureNotice && <p className="capture-notice" role="status">{practice.captureNotice}</p>}
      {practice.outputNotice && <p className="capture-notice" role="status">{practice.outputNotice}</p>}
      {source === 'microphone' && hasInputProcessing && <p className="capture-notice" role="status">This microphone reports sound processing still enabled. Try another input if drum attacks are being missed.</p>}
      {source === 'microphone' && <p className="source-note"><span className="input-level" aria-hidden="true"><i style={{ transform: `scaleX(${Math.min(1, practice.level * 4)})` }} /></span>{practice.captureInfo?.source === 'native' ? 'Native microphone' : practice.captureInfo?.inputLabel || 'Browser microphone'} · live audio</p>}
      {source === 'replay' && <p className="source-note">Recorded audio · microphone and Auto are off</p>}
      {source === 'simulation' && <p className="source-note demo-label">Generated hits · microphone is off</p>}
    </section>
    <footer className="app-footer"><span>Listen to your own time.</span>{!running && <button onClick={() => void practice.simulate()} disabled={busy || importPending}>Try a simulation <span aria-hidden="true">↗</span></button>}</footer>
    {helpOpen && <section className="help-panel"><h2>Make room for the groove.</h2><p>Choose a tempo, enable the microphone, then play. Your first strong hit sets beat 1 immediately. The clock stays fixed, so drifting ahead or behind remains visible.</p><p>Auto considers straight and triplet rhythms across a short sequence. Straight uses eighths and sixteenths; Swing / triplet uses triplet subdivisions. Fills need a little interpretation time. Ambiguous attacks get no precise score.</p><p>Play the starting hit on your intended downbeat. The counter continues through gaps shorter than a full bar. After a full bar without a hit, a single take ends and the microphone stops. Hold the record button for Auto to keep listening and start a fresh take with your next strong hit. Stop ends either mode. Use Input gain beside Record to adjust incoming microphone audio. Detection sensitivity in the imported-audio section tunes import and replay analysis only.</p><p>Audio stays on your device. The latest take is held in memory for bar review, up to two minutes; a new take replaces it and closing the app discards it unless you choose Save bar on device. Saved bars remain in local app storage. Export both the WAV and .forget files for a portable copy before clearing app or browser storage. Quiet hits under cymbals may be missed. Device timing accuracy still needs real-world calibration. Changing tempo or interpretation starts a fresh reference.</p></section>}
    {accountOpen && <AccountDialog onClose={() => setAccountOpen(false)} />}
    {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} metronomeActive={practice.metronomeActive} simulation={source === 'simulation'} />}
  </main>
}
