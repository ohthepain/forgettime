import { useEffect, useState } from 'react'
import { AudioLines, CircleHelp, Mic, Settings, Square, UserRound, Volume2, VolumeX } from 'lucide-react'
import { usePreferences } from '../lib/preferences'
import { usePractice } from '../audio/use-practice'
import { usePresentedHits } from '../audio/use-presented-hits'
import { AccountDialog } from './AccountDialog'
import { SettingsDialog } from './SettingsDialog'
import { BarWaveform } from './BarWaveform'
import { BeatPendulum } from './BeatPendulum'
import type { InterpretationMode } from '../audio/engine'
import type { MetronomeMode } from '../audio/metronome'

const MODES: { value: InterpretationMode; label: string }[] = [
  { value: 'auto', label: 'Auto' }, { value: 'straight', label: 'Straight' }, { value: 'swing', label: 'Swing / triplet' },
]
const METRONOME_MODES: { value: MetronomeMode; label: string }[] = [
  { value: 'first-bar', label: 'First bar' }, { value: 'always', label: 'Always' }, { value: 'need-help', label: 'Need help' },
]
export function PracticeScreen() {
  const { bpm, mode, startSensitivity, setBpm, setMode, metronomeEnabled, metronomeMode, helpThresholdMs, setMetronomeEnabled, setMetronomeMode } = usePreferences()
  const [tempoText, setTempoText] = useState(String(bpm))
  const [accountOpen, setAccountOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const practice = usePractice(bpm, mode, startSensitivity, { enabled: metronomeEnabled, mode: metronomeMode, thresholdMs: helpThresholdMs })
  const { snapshot, source, busy, error } = practice
  const running = source !== 'off'
  const playing = snapshot.status === 'playing'
  const showBeat = running && playing && snapshot.beat !== null
  const review = !playing && source !== 'simulation' ? practice.reviewBar : null
  const inputProcessing = practice.captureInfo?.processing
  const hasInputProcessing = inputProcessing?.autoGainControl === true
    || inputProcessing?.echoCancellation === true || inputProcessing?.noiseSuppression === true
  const presented = usePresentedHits(snapshot.hits, playing)
  useEffect(() => { void usePreferences.persist.rehydrate() }, [])
  useEffect(() => { setTempoText(String(bpm)) }, [bpm])
  const status = busy ? 'Opening microphone…' : snapshot.status === 'playing' ? `Playing · ${bpm} BPM locked`
    : snapshot.status === 'paused' ? 'Paused · listening for you'
    : snapshot.status === 'listening' ? 'Listening · play your first hit' : 'Your tempo. Your time.'
  const latest = snapshot.hits.at(-1)
  const lastScored = [...snapshot.hits].reverse().find(hit => !hit.uncertain && hit.errorMs !== null)
  const detail = latest?.uncertain ? 'Uncertain attack' : lastScored?.errorMs !== undefined && lastScored.errorMs !== null
    ? Math.abs(lastScored.errorMs) < 5 ? 'Right in the pocket' : `${Math.abs(Math.round(lastScored.errorMs))} ms ${lastScored.errorMs < 0 ? 'ahead' : 'behind'}`
    : playing ? 'Beat set' : snapshot.status === 'paused' ? 'Ready when you are' : 'Find your pocket'
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
      <div className="card-heading"><h1>Tempo</h1><span className={source === 'simulation' ? 'practice-label demo-label' : 'practice-label'}>{source === 'simulation' ? 'SIMULATION' : 'MIC PRACTICE'}</span></div>
      <div className="tempo-row">
        <div className="bpm-control"><input id="bpm" aria-label="Tempo in beats per minute" inputMode="numeric" type="number" min={30} max={300} step={1} value={tempoText} disabled={busy || source === 'simulation'} onChange={event => setTempoText(event.target.value)} onBlur={commitTempo} onKeyDown={event => { if (event.key === 'Enter') { commitTempo(); event.currentTarget.blur() } }} /><label htmlFor="bpm">BPM</label></div>
        <div className={`beat-counter ${showBeat ? 'is-visible' : ''}`} role="timer" aria-live="off" aria-hidden={!showBeat} aria-label={showBeat ? `Beat ${snapshot.beat} of 4` : undefined}>
          <div className="beat-current"><span className="beat-number">
            <BeatPendulum time={practice.captureTime} origin={snapshot.phaseOrigin} bpm={bpm} active={showBeat} />
            <span className="beat-number-value">{snapshot.beat ?? 1}</span>
          </span><span className="beat-caption">BEAT<br />OF 4</span></div>
          <div className="beat-dots" aria-hidden="true">{[1, 2, 3, 4].map(beat => <i key={beat} className={snapshot.beat === beat ? 'active' : ''} />)}</div>
        </div>
      </div>
      <p className="playing-status" role="status"><span className={`status-dot ${running ? 'active' : ''}`} />{status}</p>
      <div className="meter-labels"><span>Ahead</span><span>On time</span><span>Behind</span></div>
      <div className="timing-meter" role="img" aria-label="Timing meter. Early hits appear left, late hits right. Each line fades over one second.">
        <div className="centre-band" /><div className="centre-line" />
        {presented.hits.map(hit => <div key={hit.id} className={`hit-line ${Math.abs(hit.errorMs!) > 100 ? 'out-of-range' : ''}`} style={{ left: `${50 + Math.max(-100, Math.min(100, hit.errorMs!)) / 2}%` }} data-error-ms={hit.errorMs!.toFixed(2)} onAnimationEnd={() => presented.removeHit(hit.id)} />)}
        <span className="meter-hint">{playing ? 'Stay with your time' : snapshot.status === 'paused' ? 'Play to begin again' : running ? 'Your first strong hit sets beat 1' : 'A little more in time, every time.'}</span>
      </div>
      <div className="meter-scale"><span>−100 ms</span><span>0</span><span>+100 ms</span></div>
      <div className="result-area"><p className={latest?.uncertain ? 'result uncertain' : 'result'}>{detail}</p><p className="result-note">{latest?.uncertain ? 'No timing score for this hit' : playing ? 'Reference stays fixed as you play' : 'Let your hands do the talking'}</p></div>
      <BarWaveform waveform={review?.waveform ?? practice.waveform} source={review ? 'microphone' : source === 'off' && practice.waveform.review ? practice.waveformSource : source}
        status={snapshot.status} startSensitivity={startSensitivity}
        review={review ? { index: practice.reviewBarIndex, count: practice.reviewBarCount, availableFraction: review.availableFraction, interrupted: review.endReason === 'interrupted', previous: () => void practice.previousBar(), next: () => void practice.nextBar(), select: () => void practice.reviewCurrentBar() } : undefined} />
      <div className="metronome-control">
        <div className="metronome-heading"><span className="small-label">METRONOME</span>
          <button className={`metronome-toggle ${practice.metronomeActive ? 'is-playing' : ''}`} aria-label="Metronome sound" aria-pressed={metronomeEnabled}
            disabled={source === 'simulation'} onClick={() => setMetronomeEnabled(!metronomeEnabled)}>
            {metronomeEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}{metronomeEnabled ? practice.metronomeActive ? 'Playing' : 'On' : 'Muted'}
          </button></div>
        <div className="mode-control" role="group" aria-label="Metronome mode">{METRONOME_MODES.map(item => <button key={item.value} aria-pressed={metronomeMode === item.value} onClick={() => setMetronomeMode(item.value)} disabled={source === 'simulation'}>{item.label}</button>)}</div>
        <p className="metronome-note">{source === 'simulation' ? 'Visual simulation · metronome is silent' : !metronomeEnabled ? 'Sound is muted' : metronomeMode === 'need-help'
          ? `First bar, then help after 4 beats beyond ±${helpThresholdMs} ms` : metronomeMode === 'always' ? 'Keeps the beat until you pause' : 'Your first hit sets beat 1; the click joins on beat 2'}</p>
        {metronomeEnabled && source !== 'simulation' && <p className="metronome-note">Use headphones so the microphone hears your playing, not the click.</p>}
      </div>
      <div className="interpretation"><span className="small-label">INTERPRETATION</span><div className="mode-control" role="group" aria-label="Rhythm interpretation">{MODES.map(item => <button key={item.value} aria-pressed={mode === item.value} onClick={() => setMode(item.value)} disabled={busy || source === 'simulation'}>{item.label}</button>)}</div></div>
      {practice.canSelectInput && <div className="microphone-control"><label className="small-label" htmlFor="microphone-input">MICROPHONE</label><select id="microphone-input" value={practice.deviceId} disabled={busy || running} onChange={event => practice.setDeviceId(event.target.value)}>
        <option value="">Browser default</option>
        {practice.inputDevices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}
        {practice.deviceId && !practice.inputDevices.some(device => device.deviceId === practice.deviceId) && <option value={practice.deviceId}>Selected microphone (unavailable)</option>}
      </select>{running && <span className="microphone-hint">Stop listening to change input</span>}</div>}
      <div className="capture-controls" role="group" aria-label="Microphone capture">
        {running || busy ? <button className="primary-button stop-button" onClick={() => void practice.stop()}><Square size={15} fill="currentColor" />{busy ? 'Cancel microphone' : source === 'simulation' ? 'Stop simulation' : 'Stop listening'}</button>
          : <button className="primary-button" onClick={() => void practice.listen()}><Mic size={18} />Enable microphone</button>}
        <button className="capture-auto" aria-label="Auto capture" aria-pressed={practice.captureMode === 'auto'}
          aria-describedby="capture-mode-note" disabled={busy || (running && practice.captureMode !== 'auto')}
          onClick={() => void (practice.captureMode === 'auto' ? practice.stop() : practice.listen('auto'))}>Auto</button>
      </div>
      <p id="capture-mode-note" className="capture-mode-note">{practice.captureMode === 'auto' ? 'Auto · keeps listening between takes' : 'Single take · microphone stops after a full bar of silence'}</p>
      {practice.recordingNotice && <p className="capture-notice" role="status">{practice.recordingNotice}</p>}
      {error && <p className="error-message" role="alert">{error}</p>}
      {practice.captureNotice && <p className="capture-notice" role="status">{practice.captureNotice}</p>}
      {practice.outputNotice && <p className="capture-notice" role="status">{practice.outputNotice}</p>}
      {source === 'microphone' && hasInputProcessing && <p className="capture-notice" role="status">This microphone reports sound processing still enabled. Try another input if drum attacks are being missed.</p>}
      <p className="pause-note">A full bar of silence to start fresh.<br />{(240 / bpm).toLocaleString(undefined, { maximumFractionDigits: 2 })} seconds at {bpm} BPM · 4/4</p>
      {source === 'microphone' && <p className="source-note"><span className="input-level" aria-hidden="true"><i style={{ transform: `scaleX(${Math.min(1, practice.level * 4)})` }} /></span>{practice.captureInfo?.source === 'native' ? 'Native microphone' : practice.captureInfo?.inputLabel || 'Browser microphone'} · live audio</p>}
      {source === 'simulation' && <p className="source-note demo-label">Generated hits · microphone is off</p>}
    </section>
    <footer className="app-footer"><span>Listen to your own time.</span>{!running && <button onClick={() => void practice.simulate()} disabled={busy}>Try a simulation <span aria-hidden="true">↗</span></button>}</footer>
    {helpOpen && <section className="help-panel"><h2>Make room for the groove.</h2><p>Choose a tempo, enable the microphone, then play. Your first strong hit sets beat 1 immediately. The clock stays fixed, so drifting ahead or behind remains visible.</p><p>Auto considers straight and triplet rhythms across a short sequence. Straight uses eighths and sixteenths; Swing / triplet uses triplet subdivisions. Fills need a little interpretation time. Ambiguous attacks get no precise score.</p><p>Play the starting hit on your intended downbeat. The counter continues through gaps shorter than a full bar. After a full bar without a hit, a single take ends and the microphone stops. Choose Auto beside the microphone button to keep listening and start a fresh take with your next strong hit. Stop ends either mode. Use Start sensitivity in Settings to choose how firmly you need to play to begin; it does not change detection during the performance.</p><p>Audio stays on your device. The latest take is held in memory for bar review, up to two minutes; a new take replaces it and closing the app discards it. Quiet hits under cymbals may be missed. Device timing accuracy still needs real-world calibration. Changing tempo or interpretation starts a fresh reference.</p></section>}
    {accountOpen && <AccountDialog onClose={() => setAccountOpen(false)} />}
    {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
  </main>
}
