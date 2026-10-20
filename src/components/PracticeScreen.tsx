import { createTrainingSource } from '../audio/training-contract'
import { createLocalTrainingRepository } from '../audio/training-dataset'
import { trainingNavigation, allowWorkspaceNavigation, useTrainingSession } from "../lib/training-session"
import { DetectionSensitivity } from "./DetectionSensitivity"
import { TrainingAnnotationEditor } from "./TrainingAnnotationEditor"
import type { RecordedTake } from "../audio/recorded-take"
import { RecordControl } from './RecordControl'
import { AudioImportControls } from './AudioImportControls'
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { AudioLines, CircleHelp, Settings, UserRound, CircleCheck, Trash2 } from 'lucide-react'
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
export function PracticeScreen({ active = true }: { active?: boolean } = {}) {
  const { bpm, mode, inputGain, setBpm, setMode, metronomeEnabled, metronomeMode, helpThresholdMs } = usePreferences()
  const [annotation, setAnnotation] = useState<{ take: RecordedTake; index: number } | null>(null)
  const [annotationCloseRequest, setAnnotationCloseRequest] = useState(0)
  const [annotationOpening, setAnnotationOpening] = useState(false)
  const optimizerRunning = useTrainingSession(s => s.running)
  const optimizerProgress = useTrainingSession(s => s.progress)
  const pendingNavigation = useRef<((allowed: boolean) => void) | null>(null)
  const annotationActive = Boolean(annotation) || annotationOpening
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [candidatePage, setCandidatePage] = useState(0)
  const [inspectedCandidate, setInspectedCandidate] = useState<InspectableCandidate | null>(null)
  const [currentComparison, setCurrentComparison] = useState(true)
  const [tempoText, setTempoText] = useState(String(bpm))
  const [accountOpen, setAccountOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const practice = usePractice(bpm, mode, inputGain, { enabled: metronomeEnabled, mode: metronomeMode, thresholdMs: helpThresholdMs })
  const pendingAnnotation = useRef<{ previous: RecordedTake | null } | null>(null);
  function beginTrainingImport() { pendingAnnotation.current = { previous: practice.recordedTake }; }
  useEffect(() => {
    if (active || !pendingAnnotation.current || practice.importBusy || practice.importState || !practice.recordedTake || practice.recordedTake === pendingAnnotation.current.previous) return;
    pendingAnnotation.current = null;
    setAnnotation({ take: practice.recordedTake, index: 0 });
  }, [active, practice.recordedTake, practice.importBusy, practice.importState]);
  useEffect(() => {
    useTrainingSession.setState({ samples: practice.trainingSamples.map(({ checksum, name }) => ({ checksum, name })), importReport: practice.trainingImportReport });
    trainingNavigation.openSample = async checksum => {
      const sample = practice.trainingSamples.find(sample => sample.checksum === checksum);
      if (!sample) return;
      pendingAnnotation.current = { previous: practice.recordedTake };
      await practice.openRecordedMaterial(sample.take);
      setAnnotation({ take: sample.take, index: 0 });
    };
    return () => { trainingNavigation.openSample = undefined; };
  }, [practice.trainingSamples, practice.trainingImportReport, practice.openRecordedMaterial, practice.recordedTake]);
  const [trainingHost, setTrainingHost] = useState<HTMLElement | null>(null)
  useEffect(() => { setTrainingHost(document.getElementById("training-import-panel")) }, [])
  const { snapshot, source, busy, error } = practice
  useEffect(() => {
    trainingNavigation.guards.set("practice", async () => {
      if (annotation) {
        const allowed = await new Promise<boolean>(resolve => { pendingNavigation.current = resolve; setAnnotationCloseRequest(n => n + 1) })
        if (!allowed) return false
      }
      if (practice.importState || practice.importBusy) {
        if (!window.confirm('Discard unfinished import and leave this page?')) return false
        await practice.cancelImport()
      }
      await practice.stop()
      return true
    })
    return () => { trainingNavigation.guards.delete("practice") }
  }, [active, annotation, practice.importState, practice.importBusy, practice.cancelImport, practice.stop])
  useEffect(() => {
    useTrainingSession.setState({ current: { family: 'current', minimumRms: practice.detectorSettings.minimumRms, contrastRatio: practice.detectorSettings.contrastRatio, minSeparationMs: practice.detectorSettings.minSeparationMs, recoverySeconds: practice.detectorSettings.recoverySeconds, frequencyBalance: practice.frequencyBalance } })
  }, [practice.detectorSettings, practice.frequencyBalance])
  const adopted = useTrainingSession(s => s.adopt)
  useEffect(() => {
    if (!adopted) return
    if (adopted.family === 'mel' || source === 'microphone') { useTrainingSession.setState({ adopt: null }); return }
    void practice.stop().then(async () => { const { family: _family, frequencyBalance, ...settings } = adopted; await practice.configureDetector({ version: 1, ...settings }); await practice.configureBalance(frequencyBalance); useTrainingSession.setState({ adopt: null }) })
  }, [adopted, source, practice.stop, practice.configureDetector, practice.configureBalance])

  const importPending = practice.importBusy || Boolean(practice.importState)
  useEffect(() => { useTrainingSession.setState({ annotating: annotationActive, importing: importPending }) }, [annotationActive, importPending])
  const running = source !== 'off'
  const playing = snapshot.status === 'playing'
  const showBeat = running && playing && snapshot.beat !== null
  const review = (source === 'replay' || !playing) && source !== 'simulation' ? practice.reviewBar : null
  const replay = practice.replayState
  const currentHits = replay?.onsets.filter(hit => hit.iteration === replay.iteration) ?? []
  const currentResults = replay?.results.filter(hit => hit.iteration === replay.iteration) ?? []
  const originalTake = practice.recordedTake
  const headerAudio = practice.importState?.kind === "setup" ? practice.importState.audio : originalTake?.audio;
  const headerName = practice.importState?.file.name || originalTake?.provenance?.name || "Recorded take";
  const [membership, setMembership] = useState<{ checksum: string; fingerprint: string; included: boolean } | null>(null);
  const [removingSource, setRemovingSource] = useState(false);
  const [sourceError, setSourceError] = useState('');
  useEffect(() => {
    let alive = true;
    setMembership(null);
    async function updateMembership() {
      if (!headerAudio) return;
      try {
        const pcm = await createTrainingSource([headerAudio.samples], headerAudio.sampleRate, { kind: 'unknown', beginningAvailable: false, endAvailable: false });
        const snapshot = await createLocalTrainingRepository().read();
        if (alive) setMembership({ checksum: pcm.source.checksum, fingerprint: snapshot.fingerprint, included: snapshot.dataset.manifest.examples.some(example => example.sourceChecksum === pcm.source.checksum) });
      } catch { /* Dataset errors are shown by the Training page. */ }
    }
    void updateMembership();
    window.addEventListener('forgettime-training-changed', updateMembership);
    return () => { alive = false; window.removeEventListener('forgettime-training-changed', updateMembership); };
  }, [headerAudio]);
  async function removeTrainingSource() {
    if (!membership?.included) return;
    setRemovingSource(true);
    setSourceError('');
    try {
      const fingerprint = await createLocalTrainingRepository().deleteSource(membership.checksum, membership.fingerprint, true);
      setMembership({ ...membership, fingerprint, included: false });
    } catch (cause) { setSourceError((cause as Error).message); }
    finally { setRemovingSource(false); }
  }
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
  const detail = latest?.uncertain ? latest.reason ?? 'Uncertain attack' : lastScored?.errorMs !== undefined && lastScored.errorMs !== null
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
  const reviewDisplay = <BarWaveform waveform={reviewWaveform ?? practice.waveform} source={source === 'replay' ? 'replay' : review ? 'microphone' : source === 'off' && practice.waveform.review ? practice.waveformSource : source}
        status={snapshot.status}
        diagnostics={detailsOpen && source !== 'simulation' ? { candidates: visibleCandidates, selectedId: inspectedCandidate?.id, select: inspectCandidate } : undefined}
        review={review ? { originalAvailable, index: practice.reviewBarIndex, count: practice.reviewBarCount, availableFraction: review.availableFraction, interrupted: review.endReason === 'interrupted', previous: () => void practice.previousBar(), next: () => void practice.nextBar(), select: () => void practice.reviewCurrentBar(), loop: () => void (source === 'replay' ? practice.stop() : practice.playBar()), canLoop: review.complete && !busy } : undefined}
        comparison={review && replay ? { current: currentComparison, select: setCurrentComparison } : undefined} />
  const trainingTools = <>
    {(originalTake || practice.importState) && <div className="training-file-heading">
      <h2>{headerName}</h2>
      {membership?.included ? <CircleCheck role="img" className="training-included" aria-label="Included in training dataset" size={22} /> : <span className="training-new-pill">New</span>}
      {membership?.included && <button aria-label="Remove file from training dataset" title="Remove file and all its training bars" disabled={annotationActive || importPending || removingSource} onClick={() => void removeTrainingSource()}><Trash2 size={18} /></button>}
    </div>}
    {sourceError && <p role="alert">{sourceError}</p>}
    {!annotationActive && !importPending && review && !active && reviewDisplay}
      {review && !annotation && <button className="annotation-launch" data-testid="open-training-annotation" disabled={busy || importPending || annotationOpening} onClick={() => { const take = practice.recordedTake, index = practice.reviewBarIndex; if (!take) return; setAnnotationOpening(true); void practice.stop().then(() => { setAnnotation({ take, index }); setAnnotationOpening(false) }).catch(() => setAnnotationOpening(false)) }}>Annotate training attacks</button>}
      {annotation && <DetectionSensitivity frequencyBalance={practice.frequencyBalance} changeBalance={value => void practice.configureBalance(value)} value={practice.detectionSensitivity} disabled={false} change={value => void practice.configureSensitivity(value)} />}
      {annotation && <TrainingAnnotationEditor closeRequest={annotationCloseRequest} take={annotation.take} initialIndex={annotation.index} settings={practice.detectorSettings} balance={practice.frequencyBalance} onStay={() => { pendingNavigation.current?.(false); pendingNavigation.current = null }} onClose={() => { setAnnotation(null); pendingNavigation.current?.(true); pendingNavigation.current = null }} />}
      {!annotationActive && <AudioImportControls showImportButton={false} practice={{ ...practice,
        beginImport: () => { beginTrainingImport(); return practice.beginImport(); },
        importFiles: files => { beginTrainingImport(); return practice.importFiles(files, true); },
        chooseImportFiles: () => { beginTrainingImport(); return practice.chooseImportFiles(true); },
        useImportAudioOnly: () => { beginTrainingImport(); return practice.useImportAudioOnly(true); },
        cancelImport: () => { pendingAnnotation.current = null; return practice.cancelImport(); }, detectorSettingsSupported: practice.detectorSettingsSupported || Boolean(review && source === 'microphone'), configureBalance: value => inspectReview(() => practice.configureBalance(value)), configureSensitivity: value => inspectReview(() => practice.configureSensitivity(value)) }} />}
  </>
  return <><main className="app-shell">
    <header className="app-header"><a className="wordmark" href="/" aria-label="Forgettime home" onClick={event => { if (trainingNavigation.go) { event.preventDefault(); trainingNavigation.go('/') } else if (annotation) { event.preventDefault(); setAnnotationCloseRequest(n => n + 1) } }}><AudioLines size={21} strokeWidth={1.5} />forgettime<span className="wordmark-dot">.</span></a>
      <div className="header-actions"><a data-testid="training-nav" className="training-link" href="/training" onClick={event => { event.preventDefault(); if (trainingNavigation.go) trainingNavigation.go('/training'); else void allowWorkspaceNavigation().then(allowed => { if (allowed) window.location.assign('/training') }) }}>Training{optimizerRunning ? <span className="training-run-indicator" role="status" title={optimizerProgress || 'Optimization running'}> · Running</span> : null}</a><button className="icon-button" onClick={() => setHelpOpen(!helpOpen)} aria-label="How it works" aria-expanded={helpOpen}><CircleHelp size={19} /></button><button className="icon-button" onClick={() => setAccountOpen(true)} aria-label="Your account"><UserRound size={19} /></button><button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="Settings" aria-haspopup="dialog" aria-expanded={settingsOpen}><Settings size={19} /></button></div>
    </header>
    <section className="tempo-card" aria-label="Drum timing practice">
      <div className="practice-toolbar" role="group" aria-label="Practice controls">
        <RecordControl gainAdjustment={practice.gainAdjustment} manualInputGain={practice.manualInputGain} active={running} auto={practice.captureMode === 'auto'} busy={busy} disabled={importPending || annotationActive}
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
        <div className="bpm-control"><input id="bpm" aria-label="Tempo in beats per minute" inputMode="numeric" type="number" min={30} max={300} step={1} value={source === 'replay' ? snapshot.bpm : tempoText} disabled={annotationActive || busy || source === 'simulation' || source === 'replay'} onChange={event => setTempoText(event.target.value)} onBlur={commitTempo} onKeyDown={event => { if (event.key === 'Enter') { commitTempo(); event.currentTarget.blur() } }} /><label htmlFor="bpm">BPM</label></div>
      </div>
      {(source === 'simulation' || source === 'replay') && <p className="practice-label">{source === 'simulation' ? 'SIMULATION' : 'BAR REPLAY'}</p>}
      {status && <p className="playing-status" role="status"><span className={`status-dot ${running ? 'active' : ''}`} />{status}</p>}
      <div className="timing-meter" role="img" aria-label="Timing meter. Early hits appear left, late hits right. Each line fades over one second.">
        <div className="centre-band" /><div className="centre-line" />
        {presented.hits.map(hit => <div key={hit.id} className={`hit-line ${Math.abs(hit.errorMs!) > 100 ? 'out-of-range' : ''}`} style={{ left: `${50 + Math.max(-100, Math.min(100, hit.errorMs!)) / 2}%` }} data-error-ms={hit.errorMs!.toFixed(2)} onAnimationEnd={() => presented.removeHit(hit.id)} />)}
        <span className="meter-hint">{playing ? 'Stay with your time' : snapshot.status === 'paused' ? 'Play to begin again' : running ? 'Your first strong hit sets beat 1' : 'A little more in time, every time.'}</span>
      </div>
      <div className="meter-scale"><span>−100 ms</span><span>0</span><span>+100 ms</span></div>
      {detail && <div className="result-area"><p className={latest?.uncertain ? 'result uncertain' : 'result'}>{detail}</p><p className="result-note">{latest?.uncertain ? 'No timing score for this hit' : playing ? 'Reference stays fixed as you play' : null}</p></div>}
      {!annotation && active && reviewDisplay}


      <section className="saved-bars" aria-label="Saved bars">
        {review && <button disabled={annotationActive || practice.libraryBusy || !practice.savedBarsSupported} onClick={() => void practice.saveSelectedBar()}>Save bar on device</button>}
        <details><summary>Saved bars ({practice.savedBars.length})</summary>
          <p>Audio stays on this device. Up to 100 bars / 256 MiB. Browser storage can be cleared; download both files for a portable copy.</p>
          {practice.savedBarsSupported === false && <p>Local saved bars are unavailable in this version on this device.</p>}
          <ul>{practice.savedBars.map(bar => <li key={bar.id}>
            <span>{bar.name}{!bar.complete && ' · partial'}</span>
            <div><button aria-label={`Open ${bar.name}`} disabled={annotationActive || practice.libraryBusy || busy || importPending} onClick={() => void practice.openSavedBar(bar.id)}>Open</button>
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

        <p className="waveform-note">Fresh looping state can differ from original capture. Later repetitions may settle differently; loop joins can add attacks.</p>
      </div>}
      {review && <details><summary>Timing results</summary><p>Original: {originalAvailable ? originalResults.map(hit => hit.uncertain ? `uncertain (${hit.reason ?? 'Reason unavailable'})` : `${Math.round(hit.errorMs!)} ms`).join(', ') || 'No scored hits' : 'analysis unavailable'}</p>
          {replay && <p>Current: {replay.results.map(hit => `Loop ${hit.iteration + 1}: ${hit.uncertain ? `uncertain (${hit.reason ?? 'Reason unavailable'})` : `${Math.round(hit.errorMs!)} ms`}`).join(', ') || 'Waiting for resolved hits'}</p>}</details>}
      {source !== 'simulation' && <DetectionDetails open={detailsOpen} toggle={() => void inspectReview(() => setDetailsOpen(value => !value))} settings={practice.detectorSettings}
        originalSettings={practice.recordedTake?.settings.detector}
        candidates={candidates} selected={inspectedCandidate} select={inspectCandidate} page={activeCandidatePage} setPage={page => void inspectReview(() => setCandidatePage(page))}
        dropped={diagnosticsDropped} diagnosticsSupported={diagnosticsSupported} context={review ? currentComparison && replay ? `Current loop ${replay.iteration + 1} · fresh run ${replay.run}` : 'Original capture' : source === 'microphone' ? 'Live detector candidates' : 'Latest live candidates'} />}
      <div className="interpretation"><span className="small-label">INTERPRETATION</span><div className="mode-control" role="group" aria-label="Rhythm interpretation">{MODES.map(item => <button key={item.value} aria-pressed={mode === item.value} onClick={() => setMode(item.value)} disabled={annotationActive || busy || source === 'simulation' || source === 'replay'}>{item.label}</button>)}</div></div>

      {practice.recordingNotice && <p className="capture-notice" role="status">{practice.recordingNotice}</p>}
      {error && <p className="error-message" role="alert">{error}</p>}
      {practice.captureNotice && <p className="capture-notice" role="status">{practice.captureNotice}</p>}
      {practice.outputNotice && <p className="capture-notice" role="status">{practice.outputNotice}</p>}
      {source === 'microphone' && hasInputProcessing && <p className="capture-notice" role="status">This microphone reports sound processing still enabled. Try another input if drum attacks are being missed.</p>}
      {source === 'microphone' && <p className="source-note"><span className="input-level" aria-hidden="true"><i style={{ transform: `scaleX(${Math.min(1, practice.level * 4)})` }} /></span>{practice.captureInfo?.source === 'native' ? 'Native microphone' : practice.captureInfo?.inputLabel || 'Browser microphone'} · live audio{practice.captureInfo?.analysis?.implementation?.startsWith('selected-') ? ` · Selected ${practice.captureInfo.analysis.implementation.slice(9)} profile` : ' · Default detector'}</p>}
      {source === 'replay' && <p className="source-note">Recorded audio · microphone and Auto are off</p>}
      {source === 'simulation' && <p className="source-note demo-label">Generated hits · microphone is off</p>}
    </section>
    <footer className="app-footer"><span>Listen to your own time.</span>{!running && <button onClick={() => void practice.simulate()} disabled={annotationActive || busy || importPending}>Try a simulation <span aria-hidden="true">↗</span></button>}</footer>
    {helpOpen && <section className="help-panel"><h2>Make room for the groove.</h2><p>Choose a tempo, enable the microphone, then play. Your first strong hit sets beat 1 immediately. The clock stays fixed, so drifting ahead or behind remains visible.</p><p>Auto considers straight and triplet rhythms across a short sequence. Straight uses eighths and sixteenths; Swing / triplet uses triplet subdivisions. Fills need a little interpretation time. Ambiguous attacks get no precise score.</p><p>Play the starting hit on your intended downbeat. The counter continues through gaps shorter than a full bar. After a full bar without a hit, a single take ends and the microphone stops. Hold the record button for Auto to keep listening and start a fresh take with your next strong hit. Stop ends either mode. Use Input gain beside Record to adjust incoming microphone audio. Detection sensitivity in the imported-audio section tunes import and replay analysis only.</p><p>Audio stays on your device. The latest take is held in memory for bar review, up to two minutes; a new take replaces it and closing the app discards it unless you choose Save bar on device. Saved bars remain in local app storage. Export both the WAV and .forget files for a portable copy before clearing app or browser storage. Quiet hits under cymbals may be missed. Device timing accuracy still needs real-world calibration. Changing tempo or interpretation starts a fresh reference.</p></section>}
    {accountOpen && <AccountDialog onClose={() => setAccountOpen(false)} />}
    {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} metronomeActive={practice.metronomeActive} simulation={source === 'simulation'} />}
  </main>{trainingHost && createPortal(trainingTools, trainingHost)}</>
}
