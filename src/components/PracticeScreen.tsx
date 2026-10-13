import { useEffect, useState } from 'react'
import { AudioLines, CircleHelp, Mic, Square, UserRound } from 'lucide-react'
import { usePreferences } from '../lib/preferences'
import { usePractice } from '../audio/use-practice'
import { usePresentedHits } from '../audio/use-presented-hits'
import { AccountDialog } from './AccountDialog'
import type { InterpretationMode } from '../audio/engine'

const MODES: { value: InterpretationMode; label: string }[] = [
  { value: 'auto', label: 'Auto' }, { value: 'straight', label: 'Straight' }, { value: 'swing', label: 'Swing / triplet' },
]
export function PracticeScreen() {
  const { bpm, mode, setBpm, setMode } = usePreferences()
  const [tempoText, setTempoText] = useState(String(bpm))
  const [accountOpen, setAccountOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const practice = usePractice(bpm, mode)
  const { snapshot, source, busy, error } = practice
  const running = source !== 'off'
  const playing = snapshot.status === 'playing'
  const presented = usePresentedHits(snapshot.hits, playing)
  useEffect(() => { void usePreferences.persist.rehydrate() }, [])
  useEffect(() => { setTempoText(String(bpm)) }, [bpm])
  const status = busy ? 'Opening microphone…' : snapshot.status === 'playing' ? `Playing · ${bpm} BPM locked`
    : snapshot.status === 'finding' ? 'Finding beat…' : snapshot.status === 'paused' ? 'Paused · listening for you'
    : snapshot.status === 'listening' ? 'Listening · start playing' : 'Your tempo. Your time.'
  const latest = snapshot.hits.at(-1)
  const lastScored = [...snapshot.hits].reverse().find(hit => !hit.uncertain && hit.errorMs !== null)
  const detail = latest?.uncertain ? 'Uncertain attack' : lastScored?.errorMs !== undefined && lastScored.errorMs !== null
    ? Math.abs(lastScored.errorMs) < 5 ? 'Right in the pocket' : `${Math.abs(Math.round(lastScored.errorMs))} ms ${lastScored.errorMs < 0 ? 'ahead' : 'behind'}`
    : playing ? 'Beat set' : snapshot.status === 'finding' ? 'Play a few steady hits' : snapshot.status === 'paused' ? 'Ready when you are' : 'Find your pocket'
  function commitTempo() {
    const next = Number(tempoText)
    if (Number.isFinite(next) && next >= 30 && next <= 300) setBpm(next)
    else setTempoText(String(bpm))
  }
  return <main className="app-shell">
    <header className="app-header"><a className="wordmark" href="/" aria-label="Forgettime home"><AudioLines size={21} strokeWidth={1.5} />forgettime<span className="wordmark-dot">.</span></a>
      <div className="header-actions"><button className="icon-button" onClick={() => setHelpOpen(!helpOpen)} aria-label="How it works" aria-expanded={helpOpen}><CircleHelp size={19} /></button><button className="icon-button" onClick={() => setAccountOpen(true)} aria-label="Your account"><UserRound size={19} /></button></div>
    </header>
    <section className="tempo-card" aria-label="Drum timing practice">
      <div className="card-heading"><h1>Tempo</h1><span className={source === 'simulation' ? 'practice-label demo-label' : 'practice-label'}>{source === 'simulation' ? 'SIMULATION' : 'MIC PRACTICE'}</span></div>
      <div className="tempo-row">
        <div className="bpm-control"><input id="bpm" aria-label="Tempo in beats per minute" inputMode="numeric" type="number" min={30} max={300} step={1} value={tempoText} disabled={busy || source === 'simulation'} onChange={event => setTempoText(event.target.value)} onBlur={commitTempo} onKeyDown={event => { if (event.key === 'Enter') { commitTempo(); event.currentTarget.blur() } }} /><label htmlFor="bpm">BPM</label></div>
        <div className={`beat-counter ${playing ? 'is-visible' : ''}`} aria-hidden={!playing} aria-label={playing ? `Beat ${snapshot.beat} of 4` : undefined}>
          <div className="beat-current"><span>{snapshot.beat ?? 1}</span><span className="beat-caption">BEAT<br />OF 4</span></div>
          <div className="beat-dots">{[1, 2, 3, 4].map(beat => <i key={beat} className={snapshot.beat === beat ? 'active' : ''} />)}</div>
        </div>
      </div>
      <p className="playing-status" role="status"><span className={`status-dot ${running ? 'active' : ''}`} />{status}</p>
      <div className="meter-labels"><span>Ahead</span><span>On time</span><span>Behind</span></div>
      <div className="timing-meter" role="img" aria-label="Timing meter. Early hits appear left, late hits right. Each line fades over one second.">
        <div className="centre-band" /><div className="centre-line" />
        {presented.hits.map(hit => <div key={hit.id} className={`hit-line ${Math.abs(hit.errorMs!) > 100 ? 'out-of-range' : ''}`} style={{ left: `${50 + Math.max(-100, Math.min(100, hit.errorMs!)) / 2}%` }} data-error-ms={hit.errorMs!.toFixed(2)} onAnimationEnd={() => presented.removeHit(hit.id)} />)}
        <span className="meter-hint">{snapshot.status === 'finding' ? 'Finding your starting beat' : playing ? 'Stay with your time' : snapshot.status === 'paused' ? 'Play to begin again' : running ? 'Go ahead. Play.' : 'A little more in time, every time.'}</span>
      </div>
      <div className="meter-scale"><span>−100 ms</span><span>0</span><span>+100 ms</span></div>
      <div className="result-area"><p className={latest?.uncertain ? 'result uncertain' : 'result'}>{detail}</p><p className="result-note">{latest?.uncertain ? 'No timing score for this hit' : playing ? 'Reference stays fixed as you play' : 'Let your hands do the talking'}</p></div>
      <div className="interpretation"><span className="small-label">INTERPRETATION</span><div className="mode-control" role="group" aria-label="Rhythm interpretation">{MODES.map(item => <button key={item.value} aria-pressed={mode === item.value} onClick={() => setMode(item.value)} disabled={busy || source === 'simulation'}>{item.label}</button>)}</div></div>
      {running ? <button className="primary-button stop-button" onClick={() => void practice.stop()}><Square size={15} fill="currentColor" />{source === 'simulation' ? 'Stop simulation' : 'Stop listening'}</button>
        : <button className="primary-button" disabled={busy} onClick={() => void practice.listen()}><Mic size={18} />{busy ? 'Opening microphone…' : 'Enable microphone'}</button>}
      {error && <p className="error-message" role="alert">{error}</p>}
      <p className="pause-note">A full bar of silence to start fresh.<br />{(240 / bpm).toLocaleString(undefined, { maximumFractionDigits: 2 })} seconds at {bpm} BPM · 4/4</p>
      {source === 'microphone' && <p className="source-note"><span className="input-level" aria-hidden="true"><i style={{ transform: `scaleX(${Math.min(1, practice.level * 4)})` }} /></span>{practice.captureInfo?.source === 'native' ? 'Native microphone' : 'Browser microphone'} · live audio</p>}
      {source === 'simulation' && <p className="source-note demo-label">Generated hits · microphone is off</p>}
    </section>
    <footer className="app-footer"><span>Listen to your own time.</span>{!running && <button onClick={() => void practice.simulate()} disabled={busy}>Try a simulation <span aria-hidden="true">↗</span></button>}</footer>
    {helpOpen && <section className="help-panel"><h2>Make room for the groove.</h2><p>Choose a tempo, enable the microphone, then play. A few opening hits set your starting grid. The clock stays fixed, so drifting ahead or behind remains visible.</p><p>Auto considers straight and triplet rhythms across a short sequence. Straight uses eighths and sixteenths; Swing / triplet uses triplet subdivisions. Fills need a little interpretation time. Ambiguous attacks get no precise score.</p><p>The first reliable attack anchors beat 1; the microphone cannot know your intended downbeat. The counter continues through gaps shorter than a full bar. After a full bar without a hit, play again to establish a fresh beat.</p><p>Audio is analysed on your device and is never uploaded or saved. Quiet hits under cymbals may be missed. Device timing accuracy still needs real-world calibration. Changing tempo or interpretation starts a fresh reference.</p></section>}
    {accountOpen && <AccountDialog onClose={() => setAccountOpen(false)} />}
  </main>
}
